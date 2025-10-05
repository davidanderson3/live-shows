import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { initRecipesPanel } from '../js/recipes.js';

describe('initRecipesPanel', () => {
  beforeEach(() => {
    const dom = new JSDOM(`
      <div id="recipesList"></div>
      <input id="recipesQuery" />
      <div id="recipesApiKeyContainer">
        <input id="recipesApiKey" />
      </div>
      <button id="recipesSearchBtn"></button>
    `);
    global.document = dom.window.document;
    global.window = dom.window;
    global.localStorage = {
      getItem: () => '',
      setItem: () => {}
    };
  });

  it('fetches and displays recipes from Spoonacular', async () => {
    const mockResponse = { results: [{ title: 'Chicken Soup' }] };
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve(mockResponse)
    }));

    await initRecipesPanel();
    document.getElementById('recipesQuery').value = 'chicken';
    document.getElementById('recipesSearchBtn').click();
    await new Promise(r => setTimeout(r, 0));

    const textEl = document.querySelector('#recipesList .recipe-card__title');
    expect(textEl.textContent).toBe('Chicken Soup');
    expect(fetch).toHaveBeenCalledWith(
      'https://us-central1-decision-maker-4e1d3.cloudfunctions.net/spoonacularProxy?query=chicken'
    );
  });

  it('renders formatted metadata for multiple recipes', async () => {
    const mockResponse = {
      results: [
        {
          title: 'Soup',
          extendedIngredients: [{ original: 'chicken' }, { original: 'water' }],
          analyzedInstructions: [{ steps: [{ step: 'boil' }] }],
          servings: 2,
          summary: '<p>Rich soup</p>',
          cuisines: ['American']
        },
        {
          title: 'Stew',
          extendedIngredients: [{ original: 'beef' }, { original: 'salt' }],
          analyzedInstructions: [{ steps: [{ step: 'cook' }] }],
          readyInMinutes: 30,
          diets: ['Gluten Free']
        }
      ]
    };
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve(mockResponse)
    }));

    await initRecipesPanel();
    document.getElementById('recipesQuery').value = 'meat';
    document.getElementById('recipesSearchBtn').click();
    await new Promise(r => setTimeout(r, 0));

    const cards = document.querySelectorAll('#recipesList .recipe-card');
    expect(cards.length).toBe(2);

    const summary = cards[0].querySelector('.recipe-card__summary').textContent;
    expect(summary).toBe('Rich soup');

    const ingItems = cards[0].querySelectorAll('.recipe-card__ingredients li');
    expect(ingItems.length).toBe(2);
    expect(ingItems[0].textContent).toBe('chicken');
    expect(ingItems[1].textContent).toBe('water');

    const instructions = cards[0].querySelectorAll('.recipe-card__steps li');
    expect(instructions.length).toBe(1);
    expect(instructions[0].textContent).toBe('boil');

    const factValues = Array.from(
      cards[0].querySelectorAll('.recipe-card__fact')
    ).map(el => el.textContent);
    expect(factValues.some(text => text.includes('Servings') && text.includes('2'))).toBe(true);

    const readyFact = Array.from(
      cards[1].querySelectorAll('.recipe-card__fact')
    ).some(textEl => textEl.textContent.includes('Ready in') && textEl.textContent.includes('30'));
    expect(readyFact).toBe(true);

    const tagChip = cards[0].querySelector('.recipe-card__tag');
    expect(tagChip.textContent).toBe('American');
  });

  it('limits displayed recipes to 10', async () => {
    const mockResponse = {
      results: Array.from({ length: 12 }, (_, i) => ({
        title: `Recipe ${i}`
      }))
    };
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve(mockResponse)
    }));

    await initRecipesPanel();
    document.getElementById('recipesQuery').value = 'anything';
    document.getElementById('recipesSearchBtn').click();
    await new Promise(r => setTimeout(r, 0));

    const items = document.querySelectorAll('#recipesList .recipe-card-item');
    expect(items.length).toBe(10);
  });

  it('allows hiding a recipe persistently', async () => {
    const store = {};
    global.localStorage = {
      getItem: (key) => store[key] || '',
      setItem: (key, val) => { store[key] = val; }
    };
    const mockResponse = {
      results: [
        { title: 'A' },
        { title: 'B' }
      ]
    };
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve(mockResponse)
    }));

    await initRecipesPanel();
    document.getElementById('recipesQuery').value = 'test';
    document.getElementById('recipesSearchBtn').click();
    await new Promise(r => setTimeout(r, 0));

    const firstCard = document.querySelectorAll('#recipesList .recipe-card-item')[0];
    const hideBtn = firstCard.querySelectorAll('.recipe-card__action')[1];
    hideBtn.click();
    await new Promise(r => setTimeout(r, 0));

    document.getElementById('recipesSearchBtn').click();
    await new Promise(r => setTimeout(r, 0));

    const items = document.querySelectorAll('#recipesList .recipe-card-item');
    expect(items.length).toBe(1);
    expect(items[0].querySelector('.recipe-card__title').textContent).toBe('B');
    expect(JSON.parse(store['recipesHidden'])).toContain('A');
  });

  it('saves a recipe when save is clicked', async () => {
    const store = {};
    global.localStorage = {
      getItem: (key) => store[key] || '',
      setItem: (key, val) => { store[key] = val; }
    };
    const mockResponse = {
      results: [
        { title: 'Toast' }
      ]
    };
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve(mockResponse)
    }));

    await initRecipesPanel();
    document.getElementById('recipesQuery').value = 'bread';
    document.getElementById('recipesSearchBtn').click();
    await new Promise(r => setTimeout(r, 0));

    const saveBtn = document.querySelector('#recipesList .recipe-card__action');
    saveBtn.click();
    const saved = JSON.parse(store['recipesSaved']);
    expect(saved[0].title).toBe('Toast');
  });

  it('hides API key input by default', async () => {
    await initRecipesPanel();
    const container = document.getElementById('recipesApiKeyContainer');
    expect(container.style.display).toBe('none');
  });
});
