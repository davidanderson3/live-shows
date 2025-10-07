const DEFAULT_CLOUD_FUNCTION_BASE =
  'https://us-central1-decision-maker-4e1d3.cloudfunctions.net';

const isLikelyLocalHost = hostname => {
  if (!hostname || typeof hostname !== 'string') return false;
  const normalized = hostname.trim().toLowerCase();
  if (!normalized) return false;
  if (['localhost', '127.0.0.1', '::1'].includes(normalized)) return true;
  return (
    normalized.endsWith('.local') ||
    normalized.startsWith('192.168.') ||
    normalized.startsWith('10.') ||
    normalized.startsWith('172.16.') ||
    normalized.startsWith('172.17.') ||
    normalized.startsWith('172.18.') ||
    normalized.startsWith('172.19.') ||
    normalized.startsWith('172.20.') ||
    normalized.startsWith('172.21.') ||
    normalized.startsWith('172.22.') ||
    normalized.startsWith('172.23.') ||
    normalized.startsWith('172.24.') ||
    normalized.startsWith('172.25.') ||
    normalized.startsWith('172.26.') ||
    normalized.startsWith('172.27.') ||
    normalized.startsWith('172.28.') ||
    normalized.startsWith('172.29.') ||
    normalized.startsWith('172.30.') ||
    normalized.startsWith('172.31.')
  );
};

const resolveApiBaseUrl = () => {
  if (typeof window !== 'undefined' && window.apiBaseUrl) {
    return window.apiBaseUrl;
  }
  if (typeof process !== 'undefined' && process.env.API_BASE_URL) {
    return process.env.API_BASE_URL;
  }
  if (typeof window !== 'undefined' && window.location?.origin) {
    const { origin, hostname } = window.location;
    if (isLikelyLocalHost(hostname)) {
      return origin;
    }
  }
  return DEFAULT_CLOUD_FUNCTION_BASE;
};

const API_BASE_URL = resolveApiBaseUrl();

const stripHtml = text =>
  typeof text === 'string'
    ? text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
    : '';

const readArray = key => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error(`Failed to read ${key} from storage`, err);
    return [];
  }
};

const writeArray = (key, value) => {
  localStorage.setItem(key, JSON.stringify(value));
};

const toUniqueKey = recipe => {
  if (recipe === null || recipe === undefined) return '';
  if (typeof recipe === 'string' || typeof recipe === 'number') {
    return String(recipe);
  }
  const base = recipe.id ?? recipe.title ?? '';
  return String(base);
};

const formatPrice = cents => {
  if (typeof cents !== 'number') return '';
  const dollars = cents / 100;
  return dollars.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2
  });
};

const buildFactEntries = r => {
  const facts = [
    ['Ready in', r.readyInMinutes ? `${r.readyInMinutes} min` : null],
    ['Servings', r.servings ?? null],
    ['Score', r.spoonacularScore ?? null],
    ['Health score', r.healthScore ?? null],
    ['Likes', r.aggregateLikes ?? null],
    ['Price / serving', r.pricePerServing ? formatPrice(r.pricePerServing) : null],
    ['Time', r.time ?? null],
    ['Difficulty', r.difficulty ?? null]
  ];
  return facts.filter(([, value]) => value !== null && value !== undefined && value !== '');
};

const toInstructionSteps = r => {
  if (Array.isArray(r.analyzedInstructions)) {
    return r.analyzedInstructions
      .flatMap(instruction => instruction?.steps || [])
      .map(step => step?.step?.trim())
      .filter(Boolean);
  }
  if (Array.isArray(r.instructions)) {
    return r.instructions.map(step => stripHtml(step)).filter(Boolean);
  }
  if (typeof r.instructions === 'string') {
    const trimmed = stripHtml(r.instructions);
    if (!trimmed) return [];
    const newlineSplit = trimmed.split(/\r?\n+/).map(text => text.trim()).filter(Boolean);
    if (newlineSplit.length > 1) return newlineSplit;
    const sentenceSplit = trimmed
      .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
      .map(text => text.trim())
      .filter(Boolean);
    return sentenceSplit.length ? sentenceSplit : [trimmed];
  }
  return [];
};

const toIngredientList = r => {
  if (Array.isArray(r.extendedIngredients)) {
    return r.extendedIngredients
      .map(ing => ing?.original || ing?.name || '')
      .map(text => stripHtml(text))
      .filter(Boolean);
  }
  if (Array.isArray(r.ingredients)) {
    return r.ingredients.map(text => stripHtml(text)).filter(Boolean);
  }
  if (typeof r.ingredients === 'string') {
    const trimmed = stripHtml(r.ingredients);
    if (!trimmed) return [];
    const newlineSplit = trimmed.split(/\r?\n+/).map(text => text.trim()).filter(Boolean);
    if (newlineSplit.length > 1) return newlineSplit;
    return trimmed
      .split(/,|•|\u2022/)
      .map(text => text.trim())
      .filter(Boolean);
  }
  return [];
};

const normalizeResults = payload => {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.results)) return payload.results;
  return [];
};

const createError = (message, code) => {
  const err = new Error(message);
  err.code = code;
  return err;
};

const buildTagGroups = r => {
  const groups = [
    ['Cuisines', r.cuisines],
    ['Diets', r.diets],
    ['Dish types', r.dishTypes],
    ['Occasions', r.occasions]
  ];
  return groups
    .map(([label, values]) => ({
      label,
      items: (Array.isArray(values) ? values : []).filter(Boolean)
    }))
    .filter(group => group.items.length);
};

const buildBadges = r => {
  const booleanBadges = [
    ['Vegetarian', r.vegetarian],
    ['Vegan', r.vegan],
    ['Gluten free', r.glutenFree],
    ['Dairy free', r.dairyFree],
    ['Very healthy', r.veryHealthy]
  ];
  return booleanBadges
    .filter(([, value]) => value === true)
    .map(([label]) => label);
};

export async function initRecipesPanel() {
  const listEl = document.getElementById('recipesList');
  if (!listEl) return;
  const queryInput = document.getElementById('recipesQuery');
  const searchBtn = document.getElementById('recipesSearchBtn');

  const savedQuery = localStorage.getItem('recipesQuery') || '';
  if (queryInput) queryInput.value = savedQuery;

  const loadRecipes = async () => {
    const query = queryInput?.value.trim();
    if (!query) {
      listEl.textContent = 'Please enter search.';
      return;
    }
    if (searchBtn) searchBtn.disabled = true;
    listEl.innerHTML = '<em>Loading...</em>';
    let proxyUrl = '';
    try {
      const base = API_BASE_URL.replace(/\/$/, '');
      let proxyPath = '/api/spoonacular';
      try {
        const parsed = new URL(base);
        if (parsed.hostname.endsWith('cloudfunctions.net')) {
          proxyPath = '/spoonacularProxy';
        }
      } catch (err) {
        if (/cloudfunctions\.net/.test(base)) {
          proxyPath = '/spoonacularProxy';
        }
      }
      proxyUrl = `${base}${proxyPath}?query=${encodeURIComponent(query)}`;
      const response = await fetch(proxyUrl);
      if (!response.ok) {
        throw createError(`HTTP ${response.status}`, 'proxy_http_error');
      }

      const payload = await response.json();

      const sortedResults = normalizeResults(payload)
        .map(result => ({ result }))
        .sort((a, b) => {
          const scoreA = typeof a.result?.spoonacularScore === 'number' ? a.result.spoonacularScore : 0;
          const scoreB = typeof b.result?.spoonacularScore === 'number' ? b.result.spoonacularScore : 0;
          return scoreB - scoreA;
        });
      const recipes = sortedResults.map(({ result }) => {
        const instructions = toInstructionSteps(result);
        const ingredients = toIngredientList(result);
        const summary = stripHtml(result.summary) || instructions[0] || '';
        const facts = buildFactEntries(result);
        const tagGroups = buildTagGroups(result);
        const badges = buildBadges(result);
        const winePairing = {
          wines: Array.isArray(result.winePairing?.pairedWines)
            ? result.winePairing.pairedWines.filter(Boolean)
            : [],
          text: stripHtml(result.winePairing?.pairingText)
        };
        const storage = {
          id: result.id ?? null,
          title: result.title || 'Untitled',
          sourceUrl: result.sourceUrl || ''
        };
        const storageKey = toUniqueKey(storage);
        return {
          storage,
          storageKey,
          title: result.title || 'Untitled',
          image: result.image || '',
          summary,
          ingredients,
          instructions,
          facts,
          tagGroups,
          badges,
          sourceName: result.sourceName || '',
          sourceUrl: result.sourceUrl || '',
          winePairing
        };
      });
      if (recipes.length === 0) {
        listEl.textContent = 'No recipes found.';
        return;
      }
      const hidden = readArray('recipesHidden').map(String);
      const limited = recipes
        .filter(r => !hidden.includes(r.storageKey))
        .slice(0, 10);
      if (limited.length === 0) {
        listEl.innerHTML = '<p><em>No recipes to show. Try unhiding recipes or searching again.</em></p>';
        return;
      }
      const ul = document.createElement('ul');
      ul.className = 'recipe-card-list';
      limited.forEach(recipe => {
        const li = document.createElement('li');
        li.className = 'recipe-card-item';

        const card = document.createElement('article');
        card.className = 'recipe-card';

        const header = document.createElement('header');
        header.className = 'recipe-card__header';

        const title = document.createElement('h3');
        title.className = 'recipe-card__title';
        title.textContent = recipe.title;
        header.appendChild(title);

        const actions = document.createElement('div');
        actions.className = 'recipe-card__actions';

        const saveBtn = document.createElement('button');
        saveBtn.className = 'recipe-card__action';
        saveBtn.textContent = 'Save';
        if (
          readArray('recipesSaved').some(savedRecipe => {
            const savedKey = toUniqueKey(savedRecipe);
            return savedKey === recipe.storageKey;
          })
        ) {
          saveBtn.textContent = 'Saved';
          saveBtn.disabled = true;
        }
        saveBtn.addEventListener('click', () => {
          const saved = readArray('recipesSaved');
          if (
            !saved.some(savedRecipe => {
              const savedKey = toUniqueKey(savedRecipe);
              return savedKey === recipe.storageKey;
            })
          ) {
            saved.push(recipe.storage);
            writeArray('recipesSaved', saved);
          }
          saveBtn.textContent = 'Saved';
          saveBtn.disabled = true;
        });
        actions.appendChild(saveBtn);

        const hideBtn = document.createElement('button');
        hideBtn.className = 'recipe-card__action';
        hideBtn.textContent = 'Hide';
        hideBtn.addEventListener('click', () => {
          const stored = readArray('recipesHidden').map(String);
          if (!stored.includes(recipe.storageKey)) {
            stored.push(recipe.storageKey);
            writeArray('recipesHidden', stored);
          }
          li.remove();
        });
        actions.appendChild(hideBtn);

        header.appendChild(actions);
        card.appendChild(header);

        if (recipe.image) {
          const figure = document.createElement('figure');
          figure.className = 'recipe-card__media';
          const img = document.createElement('img');
          img.className = 'recipe-card__image';
          img.src = recipe.image;
          img.alt = `${recipe.title} photo`;
          figure.appendChild(img);
          card.appendChild(figure);
        }

        if (recipe.summary) {
          const summaryWrap = document.createElement('div');
          summaryWrap.className = 'recipe-card__summary-wrap';

          const summary = document.createElement('p');
          summary.className = 'recipe-card__summary';
          summary.textContent = recipe.summary;
          summaryWrap.appendChild(summary);

          if (recipe.summary.length > 240) {
            const toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.className = 'recipe-card__summary-toggle';
            toggle.textContent = 'Show more';
            toggle.setAttribute('aria-expanded', 'false');

            toggle.addEventListener('click', () => {
              const expanded = toggle.getAttribute('aria-expanded') === 'true';
              const nextExpanded = !expanded;
              toggle.setAttribute('aria-expanded', String(nextExpanded));
              summary.classList.toggle('recipe-card__summary--expanded', nextExpanded);
              toggle.textContent = nextExpanded ? 'Show less' : 'Show more';
            });

            summaryWrap.appendChild(toggle);
          }

          card.appendChild(summaryWrap);
        }

        if (recipe.badges.length) {
          const badgeWrap = document.createElement('div');
          badgeWrap.className = 'recipe-card__badges';
          recipe.badges.forEach(label => {
            const badge = document.createElement('span');
            badge.className = 'recipe-card__badge';
            badge.textContent = label;
            badgeWrap.appendChild(badge);
          });
          card.appendChild(badgeWrap);
        }

        if (recipe.facts.length) {
          const facts = document.createElement('dl');
          facts.className = 'recipe-card__facts';
          recipe.facts.forEach(([label, value]) => {
            const wrapper = document.createElement('div');
            wrapper.className = 'recipe-card__fact';
            const factLabel = document.createElement('dt');
            factLabel.className = 'recipe-card__fact-label';
            factLabel.textContent = label;
            const factValue = document.createElement('dd');
            factValue.className = 'recipe-card__fact-value';
            factValue.textContent = value;
            wrapper.appendChild(factLabel);
            wrapper.appendChild(factValue);
            facts.appendChild(wrapper);
          });
          card.appendChild(facts);
        }

        if (recipe.tagGroups.length) {
          const tagSection = document.createElement('div');
          tagSection.className = 'recipe-card__tags';
          recipe.tagGroups.forEach(group => {
            const groupEl = document.createElement('div');
            groupEl.className = 'recipe-card__tag-group';
            const groupLabel = document.createElement('span');
            groupLabel.className = 'recipe-card__tag-label';
            groupLabel.textContent = group.label;
            groupEl.appendChild(groupLabel);
            group.items.forEach(item => {
              const chip = document.createElement('span');
              chip.className = 'recipe-card__tag';
              chip.textContent = item;
              groupEl.appendChild(chip);
            });
            tagSection.appendChild(groupEl);
          });
          card.appendChild(tagSection);
        }

        if (recipe.ingredients.length) {
          const section = document.createElement('section');
          section.className = 'recipe-card__section';
          const heading = document.createElement('h4');
          heading.className = 'recipe-card__section-title';
          heading.textContent = 'Ingredients';
          section.appendChild(heading);
          const list = document.createElement('ul');
          list.className = 'recipe-card__ingredients';
          recipe.ingredients.forEach(item => {
            const ingItem = document.createElement('li');
            ingItem.textContent = item;
            list.appendChild(ingItem);
          });
          section.appendChild(list);
          card.appendChild(section);
        }

        if (recipe.instructions.length) {
          const section = document.createElement('section');
          section.className = 'recipe-card__section';
          const heading = document.createElement('h4');
          heading.className = 'recipe-card__section-title';
          heading.textContent = 'Instructions';
          section.appendChild(heading);
          const list = document.createElement('ol');
          list.className = 'recipe-card__steps';
          recipe.instructions.forEach(step => {
            const stepItem = document.createElement('li');
            stepItem.textContent = step;
            list.appendChild(stepItem);
          });
          section.appendChild(list);
          card.appendChild(section);
        }

        if (recipe.winePairing.wines.length || recipe.winePairing.text) {
          const section = document.createElement('section');
          section.className = 'recipe-card__section';
          const heading = document.createElement('h4');
          heading.className = 'recipe-card__section-title';
          heading.textContent = 'Wine pairing';
          section.appendChild(heading);
          if (recipe.winePairing.wines.length) {
            const wines = document.createElement('p');
            wines.className = 'recipe-card__wine-list';
            wines.textContent = recipe.winePairing.wines.join(', ');
            section.appendChild(wines);
          }
          if (recipe.winePairing.text) {
            const details = document.createElement('p');
            details.className = 'recipe-card__wine-text';
            details.textContent = recipe.winePairing.text;
            section.appendChild(details);
          }
          card.appendChild(section);
        }

        if (recipe.sourceUrl) {
          const source = document.createElement('p');
          source.className = 'recipe-card__source';
          const link = document.createElement('a');
          link.href = recipe.sourceUrl;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = recipe.sourceName
            ? `View on ${recipe.sourceName}`
            : 'View full recipe';
          source.appendChild(link);
          card.appendChild(source);
        }

        li.appendChild(card);
        ul.appendChild(li);
      });
      listEl.innerHTML = '';
      listEl.appendChild(ul);
      localStorage.setItem('recipesQuery', query);
    } catch (err) {
      console.error('Failed to load recipes', err);
      const instructions = document.createElement('div');
      instructions.className = 'recipes-error';
      instructions.innerHTML = `
        <p>We couldn't reach the recipes service.</p>
        <p>To fix this locally:</p>
        <ol>
          <li>If you have a proxy server, make sure it is running so <code>${proxyUrl}</code> is accessible.</li>
          <li>You can also set <code>window.apiBaseUrl</code> before calling <code>initRecipesPanel()</code> to point at a hosted proxy.</li>
        </ol>
        <p>After updating the configuration, try searching again.</p>
      `;
      listEl.innerHTML = '';
      listEl.appendChild(instructions);
    } finally {
      if (searchBtn) searchBtn.disabled = false;
    }
  };

  searchBtn?.addEventListener('click', loadRecipes);
  queryInput?.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      loadRecipes();
    }
  });

  if (savedQuery) {
    loadRecipes();
  }
}

if (typeof window !== 'undefined') {
  window.initRecipesPanel = initRecipesPanel;
}
