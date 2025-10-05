const API_BASE_URL =
  (typeof window !== 'undefined' && window.apiBaseUrl) ||
  (typeof process !== 'undefined' && process.env.API_BASE_URL) ||
  (typeof window !== 'undefined' && window.location?.origin) ||
  'https://us-central1-decision-maker-4e1d3.cloudfunctions.net';

export async function initRecipesPanel() {
  const listEl = document.getElementById('recipesList');
  if (!listEl) return;
  const queryInput = document.getElementById('recipesQuery');
  const apiKeyContainer = document.getElementById('recipesApiKeyContainer');
  const searchBtn = document.getElementById('recipesSearchBtn');

  const savedQuery = localStorage.getItem('recipesQuery') || '';
  if (queryInput) queryInput.value = savedQuery;
  // hide API key input when using proxy
  if (apiKeyContainer) apiKeyContainer.style.display = 'none';

  const loadRecipes = async () => {
    const query = queryInput?.value.trim();
    if (!query) {
      listEl.textContent = 'Please enter search.';
      return;
    }
    if (searchBtn) searchBtn.disabled = true;
    listEl.innerHTML = '<em>Loading...</em>';
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
      const res = await fetch(
        `${base}${proxyPath}?query=${encodeURIComponent(query)}`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const recipes = Array.isArray(data?.results)
        ? data.results.map(r => ({
            title: r.title,
            ingredients: r.extendedIngredients?.map(i => i.original).join('|') || '',
            servings: r.servings,
            instructions: r.analyzedInstructions?.[0]?.steps.map(s => s.step).join('. ') || '',
            spoonacularScore: r.spoonacularScore,
            aggregateLikes: r.aggregateLikes,
            readyInMinutes: r.readyInMinutes
          }))
        : [];
      if (recipes.length === 0) {
        listEl.textContent = 'No recipes found.';
        return;
      }
      const hidden = JSON.parse(localStorage.getItem('recipesHidden') || '[]');
      const limited = recipes
        .filter(r => !hidden.includes(r.title))
        .slice(0, 10);
      const ul = document.createElement('ul');
      limited.forEach(r => {
        const li = document.createElement('li');
        const title = document.createElement('strong');
        title.textContent = r.title || 'Untitled';
        li.appendChild(title);

        const saveBtn = document.createElement('button');
        saveBtn.textContent = 'Save';
        saveBtn.addEventListener('click', () => {
          const saved = JSON.parse(localStorage.getItem('recipesSaved') || '[]');
          if (!saved.some(s => s.title === r.title)) {
            saved.push(r);
            localStorage.setItem('recipesSaved', JSON.stringify(saved));
          }
          saveBtn.textContent = 'Saved';
          saveBtn.disabled = true;
        });
        li.appendChild(saveBtn);

        const hideBtn = document.createElement('button');
        hideBtn.textContent = 'Hide';
        hideBtn.addEventListener('click', () => {
          const stored = JSON.parse(localStorage.getItem('recipesHidden') || '[]');
          if (!stored.includes(r.title)) {
            stored.push(r.title);
            localStorage.setItem('recipesHidden', JSON.stringify(stored));
          }
          li.remove();
        });
        li.appendChild(hideBtn);

        // Ingredients
        if (r.ingredients) {
          const ingHeader = document.createElement('div');
          ingHeader.textContent = 'Ingredients';
          li.appendChild(ingHeader);
          const ingList = document.createElement('ul');
          const rawIngredients = r.ingredients.includes('|') ? r.ingredients.split('|') : r.ingredients.split(',');
          rawIngredients.map(i => i.trim()).filter(Boolean).forEach(i => {
            const ingItem = document.createElement('li');
            ingItem.textContent = i;
            ingList.appendChild(ingItem);
          });
          li.appendChild(ingList);
        }

        // Servings
        if (r.servings) {
          const servingsEl = document.createElement('p');
          servingsEl.textContent = `Servings: ${r.servings}`;
          li.appendChild(servingsEl);
        }

        // Instructions
        if (r.instructions) {
          const instrHeader = document.createElement('div');
          instrHeader.textContent = 'Instructions';
          li.appendChild(instrHeader);
          const instrList = document.createElement('ol');
          r.instructions.split('.').map(s => s.trim()).filter(Boolean).forEach(step => {
            const stepItem = document.createElement('li');
            stepItem.textContent = step;
            instrList.appendChild(stepItem);
          });
          li.appendChild(instrList);
        }

        // Other metadata
        const metaEntries = Object.entries(r).filter(([key]) => !['title', 'ingredients', 'servings', 'instructions'].includes(key));
        if (metaEntries.length) {
          const metaList = document.createElement('ul');
          metaEntries.forEach(([key, value]) => {
            const metaItem = document.createElement('li');
            metaItem.textContent = `${key}: ${value}`;
            metaList.appendChild(metaItem);
          });
          li.appendChild(metaList);
        }

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
          <li>Create a <code>.env</code> file next to <code>backend/server.js</code> with your Spoonacular key, e.g. <code>SPOONACULAR_KEY=your_api_key_here</code>.</li>
          <li>Restart the server with <code>npm start</code> so <code>/api/spoonacular</code> becomes available.</li>
          <li>If you rely on a hosted proxy instead, assign its base URL to <code>window.apiBaseUrl</code> before calling <code>initRecipesPanel()</code>.</li>
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
