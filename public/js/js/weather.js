export async function fetchWeatherData() {
  let coords = null;
  let usingDefault = false;
  let usingIp = false;
  if (navigator.geolocation) {
    try {
      coords = await new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
          pos => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
          () => resolve(null),
          { timeout: 5000 }
        );
      });
    } catch {
      coords = null;
    }
  }

  if (!coords) {
    try {
      const ipResp = await fetch('https://ipapi.co/json/');
      if (ipResp.ok) {
        const ipData = await ipResp.json();
        if (ipData.latitude && ipData.longitude) {
          coords = { lat: ipData.latitude, lon: ipData.longitude };
          usingIp = true;
        }
      }
    } catch {
      coords = null;
    }
  }

  if (!coords) {
    coords = { lat: 37.7749, lon: -122.4194 };
    usingDefault = true;
  }

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&hourly=temperature_2m,precipitation_probability&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=16&timezone=auto&temperature_unit=fahrenheit`;
  const resp = await fetch(url);
  const data = await resp.json();
  extendHourlyForecast(data);
  return { data, usingDefault, usingIp };
}

window.fetchWeatherData = fetchWeatherData;

export async function initWeatherPanel(targetId = 'weatherPanel', options = {}) {
  const panel = document.getElementById(targetId);
  if (!panel) return;

  panel.innerHTML = '<div class="full-column">Loading...</div>';

  try {
    const { data, usingDefault, usingIp } = await fetchWeatherData();
    renderWeather(panel, data, usingDefault, usingIp, options);
  } catch (err) {
    console.error('Weather fetch failed', err);
    panel.innerHTML = '<div class="full-column">Failed to fetch weather data.</div>';
  }
}

function extendHourlyForecast(data) {
  const hourly = data.hourly;
  if (!hourly || !data.daily) return;
  const precipArr = hourly.precipitation_probability;
  const lastTime = hourly.time.length
    ? new Date(hourly.time[hourly.time.length - 1])
    : null;
  const lastDay = lastTime ? new Date(lastTime.toDateString()) : null;

  data.daily.time.forEach((dateStr, idx) => {
    const dayDate = new Date(dateStr);
    if (lastDay && dayDate <= lastDay) return;
    const min = data.daily.temperature_2m_min[idx];
    const max = data.daily.temperature_2m_max[idx];
    const rainProb = data.daily.precipitation_probability_max
      ? data.daily.precipitation_probability_max[idx]
      : undefined;
    for (let h = 0; h < 24; h++) {
      const tDate = new Date(dayDate);
      tDate.setHours(h, 0, 0, 0);
      hourly.time.push(tDate.toISOString().slice(0, 16));
      const mean = (max + min) / 2;
      const amp = (max - min) / 2;
      const rad = ((h - 15) / 24) * 2 * Math.PI;
      const temp = Math.round(mean + amp * Math.sin(rad));
      hourly.temperature_2m.push(temp);
      if (precipArr) hourly.precipitation_probability.push(rainProb);
    }
  });
}

function renderWeather(panel, data, usingDefault, usingIp, opts = {}) {
  const { showHourly = true } = opts;
  if (!data) return;

  panel.innerHTML = '';
  const container = document.createElement('div');
  container.className = 'full-column';
  const title = document.createElement('h2');
  title.textContent = 'Weather';
  container.appendChild(title);
  if (usingDefault) {
    const note = document.createElement('div');
    note.textContent = 'Location unavailable; showing San Francisco weather.';
    note.style.fontStyle = 'italic';
    container.appendChild(note);
  } else if (usingIp) {
    const note = document.createElement('div');
    note.textContent = 'Using approximate location based on your IP address.';
    note.style.fontStyle = 'italic';
    container.appendChild(note);
  }

  if (showHourly) {
    const hourlyTable = document.createElement('table');
    hourlyTable.innerHTML = '<thead><tr><th>Time</th><th>Temp \xB0F</th><th>Rain %</th></tr></thead><tbody></tbody>';
    const hBody = hourlyTable.querySelector('tbody');

    const now = new Date();
    const startIdx = data.hourly.time.findIndex(t => new Date(t) >= now);
    const begin = startIdx === -1 ? 0 : startIdx;
    const currentTemp = data.hourly.temperature_2m[begin];
    if (currentTemp >= 58 && currentTemp <= 77) {
      document.body.classList.add('mild-glow');
    } else {
      document.body.classList.remove('mild-glow');
    }
    for (let i = begin; i < data.hourly.time.length; i++) {
      const t = data.hourly.time[i];
      const tr = document.createElement('tr');
      const time = new Date(t).toLocaleTimeString([], { hour: 'numeric', hour12: true });
      const temp = data.hourly.temperature_2m[i];
      const rain = data.hourly.precipitation_probability ? data.hourly.precipitation_probability[i] : '';
      if (temp >= 58 && temp <= 77) tr.classList.add('comfortable-temp');
      tr.innerHTML = `<td>${time}</td><td>${temp}</td><td class="rain-percent">${rain}</td>`;
      hBody.appendChild(tr);
    }
    container.appendChild(hourlyTable);
  }

  const dailyTable = document.createElement('table');
  dailyTable.innerHTML = '<thead><tr><th>Day</th><th>High \xB0F</th><th>Low \xB0F</th><th>Rain %</th></tr></thead><tbody></tbody>';
  const dBody = dailyTable.querySelector('tbody');
  data.daily.time.forEach((dateStr, i) => {
    const tr = document.createElement('tr');
    const day = new Date(dateStr).toLocaleDateString([], { weekday: 'short' });
    const high = data.daily.temperature_2m_max[i];
    const low = data.daily.temperature_2m_min[i];
    const rain = data.daily.precipitation_probability_max ? data.daily.precipitation_probability_max[i] : '';
    if (high >= 58 && high <= 77) tr.classList.add('comfortable-temp');
    tr.innerHTML = `<td>${day}</td><td>${high}</td><td>${low}</td><td class="rain-percent">${rain}</td>`;
    dBody.appendChild(tr);
  });

  container.appendChild(dailyTable);
  panel.appendChild(container);
}

window.initWeatherPanel = initWeatherPanel;

export function chooseWeatherIcon(rainProb) {
  if (rainProb === undefined || rainProb === null) return '☀️';
  if (rainProb >= 60) return '🌧️';
  if (rainProb >= 20) return '⛅';
  return '☀️';
}

window.chooseWeatherIcon = chooseWeatherIcon;
