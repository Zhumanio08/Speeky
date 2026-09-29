/*!
 * Speeky — логика приложения: маршрутизация, экраны, тренировка, прогресс.
 * Зависит от window.SpeekyUtils и window.SpeekyData.
 */
(function (window, document) {
  'use strict';

  var Utils = window.SpeekyUtils;
  var Data = window.SpeekyData;
  var $ = Utils.$;
  var $$ = Utils.$$;

  var PAUSE_THRESHOLD = 2.5; /* секунды тишины, после которых считаем паузу */
  var MAX_SESSIONS = 200;    /* сколько тренировок храним в истории */

  var state = {
    screen: 'lobby',
    scenarioId: null,
    roleId: null,
    lastSession: null,
    lastBadges: [],
    lastAudioUrl: null,
    progress: null
  };

  /* ------------------------------------------------------- Прогресс/хранение --- */

  function createEmptyProgress() {
    return {
      version: 1,
      createdAt: Date.now(),
      sessions: [],
      badges: [],
      theme: 'light'
    };
  }

  function loadProgress() {
    var stored = Utils.storage.read('progress', null);
    if (!stored || typeof stored !== 'object') return createEmptyProgress();
    return {
      version: 1,
      createdAt: stored.createdAt || Date.now(),
      sessions: Array.isArray(stored.sessions) ? stored.sessions : [],
      badges: Array.isArray(stored.badges) ? stored.badges : [],
      theme: stored.theme === 'dark' ? 'dark' : 'light'
    };
  }

  function saveProgress() {
    Utils.storage.write('progress', state.progress);
  }

  function computeStats() {
    var sessions = state.progress.sessions;
    var stats = {
      sessions: sessions.length,
      completed: 0,
      totalSeconds: 0,
      totalWords: 0,
      totalPauses: 0,
      scenarioIds: [],
      byScenario: {},
      rolesUsed: {},
      days: {},
      bestDay: { stamp: null, count: 0 },
      avgSeconds: 0,
      wordsPerMinute: 0
    };

    sessions.forEach(function (session) {
      stats.totalSeconds += session.seconds || 0;
      stats.totalWords += session.words || 0;
      stats.totalPauses += session.pauses || 0;
      if (session.completed) stats.completed += 1;

      var key = session.scenarioId;
      if (!stats.byScenario[key]) {
        stats.byScenario[key] = {
          title: session.scenarioTitle,
          emoji: session.scenarioEmoji,
          count: 0,
          seconds: 0,
          lastAt: 0
        };
        stats.scenarioIds.push(key);
      }
      stats.byScenario[key].count += 1;
      stats.byScenario[key].seconds += session.seconds || 0;
      stats.byScenario[key].lastAt = Math.max(stats.byScenario[key].lastAt, session.finishedAt || 0);

      stats.rolesUsed[session.roleId] = true;

      var stamp = Utils.dayStamp(session.finishedAt);
      stats.days[stamp] = (stats.days[stamp] || 0) + 1;
      if (stats.days[stamp] > stats.bestDay.count) {
        stats.bestDay = { stamp: stamp, count: stats.days[stamp] };
      }
    });

    if (stats.sessions) {
      stats.avgSeconds = Math.round(stats.totalSeconds / stats.sessions);
      var minutes = stats.totalSeconds / 60;
      stats.wordsPerMinute = minutes > 0 ? Math.round(stats.totalWords / minutes) : 0;
    }
    return stats;
  }

  function awardBadges(stats, session) {
    var fresh = [];

    function award(badgeId) {
      if (state.progress.badges.indexOf(badgeId) !== -1) return;
      state.progress.badges.push(badgeId);
      fresh.push(badgeId);
    }

    if (stats.sessions >= 1) award('first-step');
    if (stats.sessions >= 5) award('five-sessions');
    if (stats.sessions >= 10) award('ten-sessions');
    if (stats.scenarioIds.length >= Data.SCENARIOS.length) award('explorer');
    if (Object.keys(stats.rolesUsed).length >= 3) award('roles-master');
    if (session && session.completed) award('timekeeper');
    if (stats.totalSeconds >= 600) award('ten-minutes');
    if (session && (stats.days[Utils.dayStamp(session.finishedAt)] || 0) >= 3) award('three-in-day');

    return fresh;
  }

  function badgeById(badgeId) {
    for (var i = 0; i < Data.BADGES.length; i++) {
      if (Data.BADGES[i].id === badgeId) return Data.BADGES[i];
    }
    return null;
  }

  function addSession(session) {
    state.progress.sessions.push(session);
    if (state.progress.sessions.length > MAX_SESSIONS) {
      state.progress.sessions = state.progress.sessions.slice(-MAX_SESSIONS);
    }
    var stats = computeStats();
    var freshBadges = awardBadges(stats, session);
    saveProgress();
    return freshBadges;
  }

  function lastSessions(limit) {
    return state.progress.sessions.slice(-limit).reverse();
  }

  /* ------------------------------------------------------------------ Тема --- */

  function applyTheme(theme) {
    var next = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    var icon = $('#theme-icon');
    if (icon) icon.textContent = next === 'dark' ? '☀️' : '🌙';
    if (state.progress) {
      state.progress.theme = next;
      saveProgress();
    }
  }

  function toggleTheme() {
    applyTheme(state.progress.theme === 'dark' ? 'light' : 'dark');
  }

  /* -------------------------------------------------------- Маршрутизация --- */

  function parseRoute() {
    var raw = window.location.hash.replace(/^#\/?/, '');
    var parts = raw.split('/').filter(Boolean);
    if (!parts.length) return { name: 'lobby' };
    if (parts[0] === 'scenarios') return { name: 'scenarios' };
    if (parts[0] === 'progress') return { name: 'progress' };
    if (parts[0] === 'results') return { name: 'results' };
    if (parts[0] === 'scenario' && parts[1]) return { name: 'roles', scenarioId: parts[1] };
    if (parts[0] === 'train' && parts[1] && parts[2]) {
      return { name: 'training', scenarioId: parts[1], roleId: parts[2] };
    }
    return { name: 'lobby' };
  }

  var NAV_MAP = {
    lobby: 'lobby',
    scenarios: 'scenarios',
    roles: 'scenarios',
    training: 'scenarios',
    progress: 'progress',
    results: 'lobby'
  };

  function highlightNav(screenName) {
    var active = NAV_MAP[screenName] || 'lobby';
    $$('.nav__link').forEach(function (link) {
      link.classList.toggle('is-active', link.dataset.nav === active);
    });
  }

  function showScreen(screenName) {
    var screens = $$('.screen');
    var found = false;

    screens.forEach(function (screen) {
      var isTarget = screen.dataset.screen === screenName;
      screen.classList.toggle('is-active', isTarget);
      if (isTarget) {
        found = true;
        Utils.rerunAnimation(screen, 'screen--enter');
      }
    });

    if (!found && screens.length) screens[0].classList.add('is-active');

    state.screen = screenName;
    highlightNav(screenName);
    window.scrollTo({ top: 0, behavior: Utils.prefersReducedMotion() ? 'auto' : 'smooth' });
  }

  function navigate(path) {
    var target = '#' + (path || '/');
    if (window.location.hash === target) {
      renderRoute();
      return;
    }
    window.location.hash = target;
  }

  function renderRoute() {
    var route = parseRoute();

    /* Покидаем активную тренировку — останавливаем запись без сохранения. */
    if (state.screen === 'training' && route.name !== 'training' && trainer.active) {
      trainer.reset(false);
    }

    if (route.name === 'roles' || route.name === 'training') {
      if (!Data.getScenario(route.scenarioId)) {
        Utils.notify('Такого сценария нет, Алёночка. Выбери другой.', 'warn');
        navigate('/scenarios');
        return;
      }
    }

    if (route.name === 'training') {
      var role = Data.getRole(route.scenarioId, route.roleId);
      if (!role) {
        navigate('/scenario/' + route.scenarioId);
        return;
      }
      if (!trainer.isSame(role)) {
        trainer.reset(true);
        renderTraining(role);
      }
      showScreen('training');
      return;
    }

    if (route.name === 'roles') {
      renderRoles(route.scenarioId);
      showScreen('roles');
      return;
    }

    if (route.name === 'scenarios') {
      renderScenarios();
      showScreen('scenarios');
      return;
    }

    if (route.name === 'progress') {
      renderProgress();
      showScreen('progress');
      return;
    }

    if (route.name === 'results') {
      if (!state.lastSession) {
        navigate('/scenarios');
        return;
      }
      renderResults();
      showScreen('results');
      return;
    }

    renderLobby();
    showScreen('lobby');
  }

  /* ---------------------------------------------------------------- Запуск --- */

  function confirmReset() {
    if (!computeStats().sessions) {
      Utils.notify('История пока пустая, Алёночка — сбрасывать нечего.', 'info');
      return;
    }
    var approved = window.confirm('Убрать всю историю тренировок и бейджи? Отменить это будет нельзя.');
    if (!approved) return;
    var theme = state.progress.theme;
    state.progress = createEmptyProgress();
    state.progress.theme = theme;
    saveProgress();
    state.lastSession = null;
    renderRoute();
    Utils.notify('Начали с чистого листа, Алёночка!', 'success');
  }

  function onKeyDown(event) {
    if (event.key !== 'Escape') return;
    if (state.screen === 'training') {
      navigate('/scenarios');
      Utils.notify('Тренировка остановлена, Алёночка. Возвращайся, когда будешь готова.', 'info');
    }
  }

  function wireGlobalEvents() {
    Utils.on($('#theme-toggle'), 'click', toggleTheme);
    Utils.on($('#reset-progress'), 'click', confirmReset);

    Utils.on(document, 'click', function (event) {
      var target = event.target;
      if (!target || !target.closest) return;

      /* «Перейти к содержимому» не должно менять хеш-маршрут. */
      if (target.closest('.skip-link')) {
        event.preventDefault();
        var mainRegion = $('#app');
        if (mainRegion) {
          mainRegion.setAttribute('tabindex', '-1');
          mainRegion.focus();
        }
        return;
      }

      var backButton = target.closest('[data-back]');
      if (!backButton) return;
      event.preventDefault();
      var destination = backButton.dataset.back;
      if (destination === 'scenarios') {
        navigate('/scenarios');
      } else if (destination === 'roles' && trainer.role) {
        navigate('/scenario/' + trainer.role.scenarioId);
      } else {
        navigate('/');
      }
    });

    window.addEventListener('hashchange', renderRoute);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('beforeunload', function () {
      if (trainer.active) trainer.reset(false);
    });
  }

  function hideLoader() {
    var loader = $('#loader');
    if (!loader) return;
    window.setTimeout(function () {
      loader.classList.add('is-hidden');
      window.setTimeout(function () {
        loader.setAttribute('hidden', 'true');
      }, 700);
    }, 400);
  }

  /* --------------------------------------------------- Главная страница --- */

  function tipOfTheDay() {
    var stamp = Utils.dayStamp(Date.now());
    var sum = 0;
    for (var i = 0; i < stamp.length; i++) sum += stamp.charCodeAt(i);
    return Data.TIPS_OF_DAY[sum % Data.TIPS_OF_DAY.length];
  }

  function renderLobby() {
    var stats = computeStats();

    var heroStats = $('#hero-stats');
    if (heroStats) {
      var minutes = Math.round(stats.totalSeconds / 60);
      heroStats.innerHTML = [
        '<li class="hero__stat"><strong data-count="' + stats.sessions + '">0</strong><span>'
          + Utils.plural(stats.sessions, ['тренировка', 'тренировки', 'тренировок']) + '</span></li>',
        '<li class="hero__stat"><strong data-count="' + minutes + '">0</strong><span>'
          + Utils.plural(minutes, ['минута речи', 'минуты речи', 'минут речи']) + '</span></li>',
        '<li class="hero__stat"><strong data-count="' + stats.scenarioIds.length + '">0</strong><span>из '
          + Data.SCENARIOS.length + ' сценариев</span></li>',
        '<li class="hero__stat"><strong data-count="' + state.progress.badges.length + '">0</strong><span>'
          + Utils.plural(state.progress.badges.length, ['бейдж', 'бейджа', 'бейджей']) + '</span></li>'
      ].join('');

      Utils.$$('[data-count]', heroStats).forEach(function (node) {
        Utils.animateCount(node, Number(node.dataset.count), { duration: 900 });
      });
    }

    var history = $('#last-trainings');
    if (history) {
      var recent = lastSessions(3);
      if (!recent.length) {
        history.innerHTML = '<div class="empty">'
          + '<span class="empty__emoji" aria-hidden="true">🌤️</span>'
          + '<p>Здесь появятся твои тренировки, Алёночка. Первая — самая важная!</p>'
          + '<a class="btn btn--primary btn--sm" href="#/scenarios">Выбрать сценарий</a>'
          + '</div>';
      } else {
        history.innerHTML = recent.map(function (session) {
          return '<a class="history-item" href="#/train/' + session.scenarioId + '/' + session.roleId + '">'
            + '<span class="history-item__emoji" aria-hidden="true">' + session.scenarioEmoji + '</span>'
            + '<span class="history-item__body">'
            + '<strong>' + Utils.escapeHtml(session.scenarioTitle) + '</strong>'
            + '<span class="history-item__meta">' + Utils.escapeHtml(session.roleLabel) + ' · '
            + Utils.formatDate(session.finishedAt) + '</span>'
            + '</span>'
            + '<span class="history-item__value">' + Utils.formatClock(session.seconds) + '</span>'
            + '</a>';
        }).join('');
      }
    }

    var tipCard = $('#tip-of-day');
    if (tipCard) {
      tipCard.innerHTML = '<p class="card__eyebrow">Совет дня</p>'
        + '<p class="tip-of-day__text">' + Utils.escapeHtml(tipOfTheDay()) + '</p>'
        + '<p class="tip-of-day__foot">Алёночка, попробуй применить это в ближайшей тренировке.</p>';
    }
  }

  /* ------------------------------------------------- Выбор сценария/роли --- */

  function durationRange(scenario) {
    var values = Object.keys(scenario.roles).map(function (key) {
      return scenario.roles[key].duration;
    });
    var min = Math.round(Math.min.apply(null, values) / 60);
    var max = Math.round(Math.max.apply(null, values) / 60);
    return min === max ? min + ' мин' : min + '–' + max + ' мин';
  }

  function renderScenarios() {
    var grid = $('#scenarios-grid');
    if (!grid) return;
    var stats = computeStats();

    grid.innerHTML = Data.SCENARIOS.map(function (scenario) {
      var info = stats.byScenario[scenario.id];
      var rolesCount = Object.keys(scenario.roles).length;
      var badge = info
        ? '<span class="pill pill--done">✓ ' + info.count + ' '
          + Utils.plural(info.count, ['тренировка', 'тренировки', 'тренировок']) + '</span>'
        : '<span class="pill">ещё не пробовала</span>';

      return '<a class="scenario card card--interactive" href="#/scenario/' + scenario.id + '">'
        + '<span class="scenario__top"><span class="scenario__emoji" aria-hidden="true">'
        + scenario.emoji + '</span>' + badge + '</span>'
        + '<span class="scenario__title">' + Utils.escapeHtml(scenario.title) + '</span>'
        + '<span class="scenario__tagline">' + Utils.escapeHtml(scenario.tagline) + '</span>'
        + '<span class="scenario__desc">' + Utils.escapeHtml(scenario.description) + '</span>'
        + '<span class="scenario__footer">'
        + '<span class="pill">⏱ ' + durationRange(scenario) + '</span>'
        + '<span class="pill">' + rolesCount + ' ' + Utils.plural(rolesCount, ['роль', 'роли', 'ролей']) + '</span>'
        + '<span class="scenario__cta">Выбрать →</span>'
        + '</span>'
        + '</a>';
    }).join('');
  }

  function renderRoles(scenarioId) {
    var scenario = Data.getScenario(scenarioId);
    if (!scenario) return;

    var title = $('#roles-title');
    if (title) title.textContent = scenario.emoji + ' ' + scenario.title;
    var text = $('#roles-text');
    if (text) text.textContent = scenario.description + ' Теперь выбери, кем ты будешь в этом разговоре.';

    var grid = $('#roles-grid');
    if (!grid) return;

    grid.innerHTML = Data.listRoles(scenarioId).map(function (role) {
      return '<a class="role card card--interactive" href="#/train/' + role.scenarioId + '/' + role.roleId + '">'
        + '<span class="role__emoji" aria-hidden="true">' + role.emoji + '</span>'
        + '<span class="role__title">' + Utils.escapeHtml(role.label) + '</span>'
        + '<span class="role__hint">' + Utils.escapeHtml(role.hint) + '</span>'
        + '<span class="role__summary">' + Utils.escapeHtml(role.summary) + '</span>'
        + '<span class="role__goal"><strong>Цель:</strong> ' + Utils.escapeHtml(role.goal) + '</span>'
        + '<span class="role__meta"><span class="pill pill--time">⏱ '
        + Utils.formatShort(role.duration) + '</span></span>'
        + '<span class="role__cta">Тренироваться →</span>'
        + '</a>';
    }).join('');
  }

  /* --------------------------------------------------- Экран тренировки --- */

  function capabilityNote() {
    if (Utils.supportsMediaRecorder() && Utils.supportsSpeechRecognition()) {
      return 'Разреши доступ к микрофону один раз: мы посчитаем слова и паузы и сохраним запись, '
        + 'чтобы ты могла послушать себя после тренировки.';
    }
    if (Utils.supportsSpeechRecognition()) {
      return 'Запись голоса в этом браузере недоступна, но слова и паузы мы посчитаем. Говори вслух — это главное!';
    }
    if (Utils.supportsMediaRecorder()) {
      return 'Мы сохраним запись и время выступления. Подсчёт слов работает в браузерах с распознаванием речи.';
    }
    return 'Микрофон в этом браузере недоступен — тренируемся по таймеру. Это тоже отлично работает!';
  }

  function planList(items) {
    return items.map(function (text, index) {
      return '<li class="plan__item"><span class="plan__num" aria-hidden="true">' + (index + 1)
        + '</span><span class="plan__text">' + Utils.escapeHtml(text) + '</span></li>';
    }).join('');
  }

  function tipList(items) {
    return items.map(function (text) {
      return '<li class="tips__item">' + Utils.escapeHtml(text) + '</li>';
    }).join('');
  }

  function cheatSheetList(items) {
    return items.map(function (text) {
      return '<li class="cheatsheet__item">' + Utils.escapeHtml(text) + '</li>';
    }).join('');
  }

  function meterMarkup(bars) {
    var html = '';
    for (var i = 0; i < bars; i++) html += '<span class="meter__bar"></span>';
    return html;
  }

  function updateTimerUI(planned, elapsed) {
    var remaining = Math.max(0, planned - elapsed);
    var value = $('#timer-value');
    var fill = $('#timer-fill');
    var timer = value ? value.closest('.timer') : null;
    if (value) value.textContent = Utils.formatClock(remaining);
    if (fill) fill.style.width = (planned ? (remaining / planned) * 100 : 0) + '%';
    if (timer) timer.classList.toggle('timer--low', planned > 0 && remaining / planned <= 0.25);
  }

  function setRecorderState(mode) {
    var recorder = $('#recorder');
    var recordButton = $('#record-btn');
    var finishButton = $('#finish-btn');
    if (recorder) recorder.classList.toggle('is-recording', mode === 'recording');
    if (recordButton) recordButton.hidden = mode === 'recording';
    if (finishButton) finishButton.hidden = mode !== 'recording';
  }

  function setStatus(text) {
    var status = $('#recorder-status');
    if (status) status.textContent = text;
  }

  function clearMeter() {
    Utils.$$('#meter .meter__bar').forEach(function (bar) {
      bar.classList.remove('is-on');
    });
  }

  function wireRecorder() {
    Utils.on($('#record-btn'), 'click', function () {
      trainer.start();
    });
    Utils.on($('#finish-btn'), 'click', function () {
      finishTraining(false);
    });
  }

  function renderTraining(role) {
    var root = $('#training-root');
    if (!root) return;

    root.innerHTML = '<div class="training">'
      + '<button class="back-link" type="button" data-back="roles">← Выбрать другую роль</button>'
      + '<div class="training__head">'
      + '<p class="training__eyebrow">' + role.scenarioEmoji + ' ' + Utils.escapeHtml(role.scenarioTitle)
      + ' · ' + role.emoji + ' ' + Utils.escapeHtml(role.label) + '</p>'
      + '<h1 class="training__title">' + Utils.escapeHtml(role.summary) + '</h1>'
      + '<p class="training__text">Таймер рассчитан на ' + Utils.formatShort(role.duration)
      + '. Говори вслух — так навык закрепляется быстрее всего.</p>'
      + '</div>'
      + '<div class="grid grid--2 training__grid">'
      + '<section class="card card--goal">'
      + '<h2 class="card__title">🎯 Ваша цель</h2>'
      + '<p class="goal__text">' + Utils.escapeHtml(role.goal) + '</p>'
      + '<h3 class="card__subtitle">План выступления</h3>'
      + '<ol class="plan">' + planList(role.instructions) + '</ol>'
      + '</section>'
      + '<section class="card card--tips">'
      + '<h2 class="card__title">💪 Советы для уверенности</h2>'
      + '<ul class="tips">' + tipList(role.allTips) + '</ul>'
      + '<details class="cheatsheet">'
      + '<summary class="cheatsheet__summary">Шпаргалка: важные фразы</summary>'
      + '<ul class="cheatsheet__list">' + cheatSheetList(role.cheatSheet) + '</ul>'
      + '</details>'
      + '</section>'
      + '</div>'
      + '<section class="recorder card" id="recorder">'
      + '<div class="recorder__top">'
      + '<div class="timer">'
      + '<span class="timer__label">Время на выступление</span>'
      + '<span class="timer__value" id="timer-value">' + Utils.formatClock(role.duration) + '</span>'
      + '<span class="timer__track"><span class="timer__fill" id="timer-fill"></span></span>'
      + '</div>'
      + '<div class="meter" id="meter" aria-hidden="true">' + meterMarkup(14) + '</div>'
      + '</div>'
      + '<p class="recorder__status" id="recorder-status">Алёночка, всё готово! '
      + 'Нажми «Начните говорить» — и рассказывай вслух.</p>'
      + '<div class="recorder__actions">'
      + '<button class="btn btn--record btn--lg" id="record-btn" type="button">'
      + '<span class="btn__pulse" aria-hidden="true"></span>Начните говорить</button>'
      + '<button class="btn btn--primary btn--lg" id="finish-btn" type="button" hidden>Завершить выступление</button>'
      + '<a class="btn btn--ghost btn--lg" href="#/scenarios">Выйти без сохранения</a>'
      + '</div>'
      + '<p class="recorder__note">' + capabilityNote() + '</p>'
      + '</section>'
      + '</div>';

    trainer.role = role;
    trainer.planned = role.duration;
    trainer.active = false;
    updateTimerUI(role.duration, 0);
    setRecorderState('idle');
    clearMeter();
    wireRecorder();
  }

  /* ------------------------------------------------------ Механика записи --- */

  var trainer = {
    role: null,
    active: false,
    finishing: false,
    abandoned: false,
    planned: 0,
    startedAt: 0,
    elapsed: 0,
    pauses: 0,
    transcript: '',
    heardWords: 0,
    lastVoiceAt: 0,
    restartCount: 0,
    timerId: null,
    meterFrame: null,
    audioContext: null,
    analyser: null,
    stream: null,
    recorder: null,
    chunks: [],
    recognition: null,

    isSame: function (role) {
      return Boolean(this.active && this.role && role
        && this.role.scenarioId === role.scenarioId
        && this.role.roleId === role.roleId);
    },

    start: function () {
      if (this.active) return;
      if (state.lastAudioUrl) {
        window.URL.revokeObjectURL(state.lastAudioUrl);
        state.lastAudioUrl = null;
      }
      this.active = true;
      this.finishing = false;
      this.abandoned = false;
      this.startedAt = Date.now();
      this.elapsed = 0;
      this.pauses = 0;
      this.transcript = '';
      this.heardWords = 0;
      this.lastVoiceAt = 0;
      this.restartCount = 0;
      this.chunks = [];

      setRecorderState('recording');
      updateTimerUI(this.planned, 0);
      attachMicrophone();
      startRecognition();
      startTimerLoop();
      setStatus('Говори, Алёночка! Слушаю внимательно — паузы делай спокойно.');
    },

    reset: function () {
      this.abandoned = true;
      stopHardware();
      this.active = false;
      this.finishing = false;
      this.elapsed = 0;
      this.pauses = 0;
      this.transcript = '';
      this.heardWords = 0;
      this.lastVoiceAt = 0;
      this.chunks = [];
      setRecorderState('idle');
      clearMeter();
    }
  };

  function startTimerLoop() {
    stopTimerLoop();
    trainer.timerId = window.setInterval(function () {
      if (!trainer.active) return;
      trainer.elapsed = Math.min((Date.now() - trainer.startedAt) / 1000, trainer.planned);
      updateTimerUI(trainer.planned, trainer.elapsed);
      updateLiveStatus();
      if (trainer.elapsed >= trainer.planned) finishTraining(true);
    }, 200);
  }

  function stopTimerLoop() {
    if (trainer.timerId) {
      window.clearInterval(trainer.timerId);
      trainer.timerId = null;
    }
  }

  function updateLiveStatus() {
    var parts = ['Говорим ' + Utils.formatClock(Math.floor(trainer.elapsed))];
    if (Utils.supportsSpeechRecognition()) {
      parts.push('слов: ' + trainer.heardWords);
      parts.push('пауз: ' + trainer.pauses);
    }
    setStatus('Алёночка, ' + parts.join(' · '));
  }

  function attachMicrophone() {
    if (!Utils.supportsMediaRecorder()) return;
    window.navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      if (!trainer.active) {
        stream.getTracks().forEach(function (track) { track.stop(); });
        return;
      }
      trainer.stream = stream;
      try {
        trainer.recorder = new window.MediaRecorder(stream);
        trainer.recorder.ondataavailable = function (event) {
          if (event.data && event.data.size > 0) trainer.chunks.push(event.data);
        };
        trainer.recorder.onstop = function () {
          buildAudioUrl();
        };
        trainer.recorder.start();
      } catch (error) {
        trainer.recorder = null;
      }
      startMeter(stream);
    }).catch(function () {
      Utils.notify('Микрофон не включился, Алёночка. Ничего страшного — тренируемся по таймеру!', 'warn', 5200);
    });
  }

  function buildAudioUrl() {
    /* Запись прерванной тренировки не привязываем к прошлому результату. */
    if (trainer.abandoned || !trainer.chunks.length) return;
    var blob = new Blob(trainer.chunks, { type: trainer.chunks[0].type || 'audio/webm' });
    state.lastAudioUrl = window.URL.createObjectURL(blob);
    if (state.lastSession) state.lastSession.hasRecording = true;
    if (state.screen === 'results') mountPlayer();
  }

  function startMeter(stream) {
    if (!Utils.supportsAudioContext()) return;
    var context = Utils.createAudioContext();
    if (!context) return;

    var source = context.createMediaStreamSource(stream);
    var analyser = context.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.75;
    source.connect(analyser);

    trainer.audioContext = context;
    trainer.analyser = analyser;

    var data = new Uint8Array(analyser.frequencyBinCount);
    var bars = $$('#meter .meter__bar');

    function frame() {
      if (!trainer.active) return;
      analyser.getByteFrequencyData(data);

      var sum = 0;
      for (var i = 0; i < data.length; i++) sum += data[i];
      var level = Math.min(1, (sum / data.length / 255) * 2.6);

      bars.forEach(function (bar, index) {
        var shape = Math.sin(((index + 1) / bars.length) * Math.PI);
        var height = Math.max(7, Math.round(level * shape * 100));
        bar.style.height = height + '%';
        bar.classList.toggle('is-on', height > 16);
      });

      trainer.meterFrame = window.requestAnimationFrame(frame);
    }

    frame();
  }

  function startRecognition() {
    var Recognition = Utils.getSpeechRecognition();
    if (!Recognition) return;

    var recognition;
    try {
      recognition = new Recognition();
    } catch (error) {
      return;
    }

    recognition.lang = 'ru-RU';
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = function (event) {
      var now = Date.now();
      if (trainer.lastVoiceAt && now - trainer.lastVoiceAt > PAUSE_THRESHOLD * 1000) {
        trainer.pauses += 1;
      }
      trainer.lastVoiceAt = now;

      for (var i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          trainer.transcript += ' ' + event.results[i][0].transcript;
          trainer.heardWords = Utils.countWords(trainer.transcript);
        }
      }
    };

    /* Ошибки распознавания не должны мешать тренировке. */
    recognition.onerror = function () {};

    recognition.onend = function () {
      if (!trainer.active || trainer.finishing) return;
      trainer.restartCount += 1;
      /* браузер иногда сам останавливает распознавание — перезапускаем */
      if (trainer.restartCount > 200) return;
      window.setTimeout(function () {
        if (trainer.active && trainer.recognition) {
          try {
            trainer.recognition.start();
          } catch (error) {
            /* распознавание уже запущено */
          }
        }
      }, 350);
    };

    try {
      recognition.start();
      trainer.recognition = recognition;
    } catch (error) {
      trainer.recognition = null;
    }
  }

  function stopHardware() {
    stopTimerLoop();

    if (trainer.recognition) {
      try {
        trainer.recognition.onend = null;
        trainer.recognition.stop();
      } catch (error) {
        /* распознавание уже остановлено */
      }
      trainer.recognition = null;
    }

    if (trainer.recorder && trainer.recorder.state !== 'inactive') {
      try {
        trainer.recorder.stop();
      } catch (error) {
        /* запись уже остановлена */
      }
    }
    trainer.recorder = null;

    if (trainer.stream) {
      trainer.stream.getTracks().forEach(function (track) { track.stop(); });
      trainer.stream = null;
    }

    if (trainer.meterFrame) {
      window.cancelAnimationFrame(trainer.meterFrame);
      trainer.meterFrame = null;
    }

    if (trainer.audioContext) {
      try {
        trainer.audioContext.close();
      } catch (error) {
        /* контекст уже закрыт */
      }
      trainer.audioContext = null;
    }

    clearMeter();
  }

  function finishTraining(auto) {
    if (!trainer.active || trainer.finishing) return;
    trainer.finishing = true;

    var elapsed = (Date.now() - trainer.startedAt) / 1000;
    var seconds = auto ? trainer.planned : Utils.clamp(Math.round(elapsed), 1, trainer.planned);

    if (trainer.lastVoiceAt && (Date.now() - trainer.lastVoiceAt) > PAUSE_THRESHOLD * 1000) {
      trainer.pauses += 1;
    }

    var session = {
      id: Utils.uid('session'),
      scenarioId: trainer.role.scenarioId,
      scenarioTitle: trainer.role.scenarioTitle,
      scenarioEmoji: trainer.role.scenarioEmoji,
      roleId: trainer.role.roleId,
      roleLabel: trainer.role.label,
      roleEmoji: trainer.role.emoji,
      startedAt: trainer.startedAt,
      finishedAt: Date.now(),
      plannedSeconds: trainer.planned,
      seconds: seconds,
      words: trainer.heardWords,
      pauses: trainer.pauses,
      completed: Boolean(auto),
      hasRecording: false
    };

    var freshBadges = addSession(session);

    state.lastSession = session;
    state.lastBadges = freshBadges;
    state.lastAudioUrl = null;

    trainer.active = false;
    trainer.finishing = false;
    stopHardware();

    navigate('/results');
  }

  /* ------------------------------------------------------- Экран итогов --- */

  function praiseFor(session) {
    var base = Utils.randomItem(Data.PRAISE);
    if (session.completed) {
      return base + ' Ты проговорила до конца таймера — отличная выдержка!';
    }
    if (session.seconds < 20) {
      return base + ' Начни с коротких подходов, дальше будешь говорить всё дольше.';
    }
    return base;
  }

  function mountPlayer() {
    var slot = $('#recording-slot');
    if (!slot) return;

    if (!state.lastAudioUrl) {
      slot.innerHTML = '<p class="results__meta">'
        + (Utils.supportsMediaRecorder()
          ? 'Запись ещё обрабатывается или микрофон был недоступен — зато время и прогресс уже сохранены.'
          : 'Запись голоса в этом браузере недоступна, зато время и прогресс сохранены.')
        + '</p>';
      return;
    }

    slot.innerHTML = '<div class="player-wrap">'
      + '<p class="results__meta">Послушай себя: обрати внимание на окончания слов и паузы. '
      + 'Запись доступна до следующей тренировки.</p>'
      + '<audio class="player" controls preload="metadata" src="' + state.lastAudioUrl + '"></audio>'
      + '</div>';
  }

  function renderResults() {
    var root = $('#results-root');
    var session = state.lastSession;
    if (!root || !session) return;

    var freshBadges = state.lastBadges || [];
    var wordsPerMinute = session.seconds > 0
      ? Math.round(session.words / (session.seconds / 60))
      : 0;

    var statItems = [
      { value: Utils.formatClock(session.seconds), label: 'Время говорения' },
      { value: session.words ? String(session.words) : '—', label: 'Слов сказано' },
      { value: Utils.supportsSpeechRecognition() ? String(session.pauses) : '—', label: 'Паузы длиннее 2,5 с' },
      { value: wordsPerMinute ? String(wordsPerMinute) : '—', label: 'Темп речи, слов/мин' }
    ];

    var statsHtml = statItems.map(function (item) {
      return '<div class="stat card">'
        + '<span class="stat__value">' + Utils.escapeHtml(item.value) + '</span>'
        + '<span class="stat__label">' + Utils.escapeHtml(item.label) + '</span>'
        + '</div>';
    }).join('');

    var badgeHtml = '';
    if (freshBadges.length) {
      badgeHtml = '<div class="badge-wall">' + freshBadges.map(function (badgeId) {
        var badge = badgeById(badgeId);
        if (!badge) return '';
        return '<div class="badge badge--unlocked badge--fresh">'
          + '<span class="badge__emoji" aria-hidden="true">' + badge.emoji + '</span>'
          + '<span class="badge__title">Разблокировано: ' + Utils.escapeHtml(badge.title) + '</span>'
          + '<span class="badge__desc">' + Utils.escapeHtml(badge.description) + '</span>'
          + '</div>';
      }).join('') + '</div>';
    } else {
      badgeHtml = '<p class="results__meta">Новых бейджей сегодня нет — но каждая тренировка '
        + 'приближает следующий. Загляни в «Прогресс», чтобы увидеть, сколько уже сделано.</p>';
    }

    root.innerHTML = '<div class="results">'
      + '<div class="card results__hero">'
      + '<p class="results__emoji" aria-hidden="true">🎉</p>'
      + '<h1 class="results__title">Вы закончили тренировку!</h1>'
      + '<p class="results__praise">' + Utils.escapeHtml(praiseFor(session)) + '</p>'
      + '<p class="results__meta">' + session.scenarioEmoji + ' '
      + Utils.escapeHtml(session.scenarioTitle) + ' · ' + session.roleEmoji + ' '
      + Utils.escapeHtml(session.roleLabel) + ' · ' + Utils.formatDate(session.finishedAt)
      + (session.completed ? ' · до конца таймера' : '') + '</p>'
      + '</div>'
      + '<div class="grid grid--4 stats">' + statsHtml + '</div>'
      + '<section class="card"><h2 class="card__title">'
      + (freshBadges.length ? '✨ Новые достижения' : '🏅 Достижения') + '</h2>'
      + badgeHtml + '</section>'
      + '<section class="card"><h2 class="card__title">🔊 Твоя запись</h2>'
      + '<div id="recording-slot"></div></section>'
      + '<div class="results__actions">'
      + '<button class="btn btn--primary btn--lg" type="button" id="repeat-btn">Попробовать ещё</button>'
      + '<a class="btn btn--ghost btn--lg" href="#/scenarios">Другой сценарий</a>'
      + '<a class="btn btn--ghost btn--lg" href="#/">На главную</a>'
      + '</div>'
      + '</div>';

    Utils.on($('#repeat-btn'), 'click', function () {
      navigate('/train/' + session.scenarioId + '/' + session.roleId);
    });
    mountPlayer();
  }

  function start() {
    state.progress = loadProgress();
    applyTheme(state.progress.theme);
    wireGlobalEvents();
    if (!Utils.isStorageAvailable()) {
      Utils.notify('Браузер не сохраняет данные — прогресс будет только в этой вкладке.', 'warn', 6000);
    }
    renderRoute();
    hideLoader();
  }

  /* ------------------------------------------------------ Экран прогресса --- */

  function renderProgress() {
    var root = $('#progress-root');
    if (!root) return;

    var stats = computeStats();

    if (!stats.sessions) {
      root.innerHTML = '<div class="card"><div class="empty">'
        + '<span class="empty__emoji" aria-hidden="true">📈</span>'
        + '<p>Пока здесь тихо, Алёночка. Одна тренировка — и появятся цифры, график и бейджи.</p>'
        + '<a class="btn btn--primary btn--sm" href="#/scenarios">Начать тренировку</a>'
        + '</div></div>';
      return;
    }

    var numbers = [
      { value: String(stats.sessions), label: 'Всего тренировок' },
      { value: String(Math.round(stats.totalSeconds / 60)), label: 'Минут чистой речи' },
      { value: String(stats.totalWords), label: 'Слов сказано' },
      { value: stats.scenarioIds.length + ' из ' + Data.SCENARIOS.length, label: 'Сценариев освоено' },
      { value: state.progress.badges.length + ' из ' + Data.BADGES.length, label: 'Бейджей получено' },
      { value: Utils.formatShort(stats.avgSeconds), label: 'Средняя тренировка' },
      { value: stats.wordsPerMinute ? String(stats.wordsPerMinute) : '—', label: 'Темп речи, слов/мин' },
      { value: String(stats.completed), label: 'Дошла до конца таймера' }
    ];

    var numbersHtml = numbers.map(function (item) {
      return '<div class="progress__number"><strong>' + Utils.escapeHtml(item.value)
        + '</strong><span>' + Utils.escapeHtml(item.label) + '</span></div>';
    }).join('');

    var maxCount = 1;
    Data.SCENARIOS.forEach(function (scenario) {
      var info = stats.byScenario[scenario.id];
      if (info) maxCount = Math.max(maxCount, info.count);
    });

    var chartHtml = Data.SCENARIOS.map(function (scenario) {
      var info = stats.byScenario[scenario.id];
      var count = info ? info.count : 0;
      var width = Math.round((count / maxCount) * 100);
      return '<div class="chart__row">'
        + '<span class="chart__label"><span aria-hidden="true">' + scenario.emoji + '</span>'
        + Utils.escapeHtml(scenario.title) + '</span>'
        + '<span class="chart__track"><span class="chart__fill" style="width:' + width + '%"></span></span>'
        + '<span class="chart__value">' + count + ' '
        + Utils.plural(count, ['тренировка', 'тренировки', 'тренировок']) + '</span>'
        + '</div>';
    }).join('');

    var badgesHtml = Data.BADGES.map(function (badge) {
      var unlocked = state.progress.badges.indexOf(badge.id) !== -1;
      return '<div class="badge ' + (unlocked ? 'badge--unlocked' : 'badge--locked') + '">'
        + '<span class="badge__emoji" aria-hidden="true">' + badge.emoji + '</span>'
        + '<span class="badge__title">' + Utils.escapeHtml(badge.title) + '</span>'
        + '<span class="badge__desc">' + Utils.escapeHtml(badge.description) + '</span>'
        + '</div>';
    }).join('');

    var rows = state.progress.sessions.slice(-15).reverse().map(function (session) {
      return '<tr>'
        + '<td>' + Utils.formatDate(session.finishedAt) + '</td>'
        + '<td>' + session.scenarioEmoji + ' ' + Utils.escapeHtml(session.scenarioTitle) + '</td>'
        + '<td>' + session.roleEmoji + ' ' + Utils.escapeHtml(session.roleLabel) + '</td>'
        + '<td>' + Utils.formatClock(session.seconds) + (session.completed ? ' ✓' : '') + '</td>'
        + '</tr>';
    }).join('');

    root.innerHTML = '<div class="progress">'
      + '<div class="progress__numbers">' + numbersHtml + '</div>'
      + '<section class="card">'
      + '<h2 class="card__title">Тренировки по сценариям</h2>'
      + '<div class="chart">' + chartHtml + '</div>'
      + '</section>'
      + '<section class="card">'
      + '<h2 class="card__title">Достижения</h2>'
      + '<div class="badge-wall">' + badgesHtml + '</div>'
      + '</section>'
      + '<section class="card">'
      + '<div class="progress__section-title">'
      + '<h2 class="card__title">История тренировок</h2>'
      + '<span class="results__meta">' + (stats.bestDay.stamp
        ? 'Лучший день: ' + stats.bestDay.count + ' ' + Utils.plural(stats.bestDay.count, ['тренировка', 'тренировки', 'тренировок'])
        : '') + '</span>'
      + '</div>'
      + '<div class="table-wrap"><table class="history-table">'
      + '<thead><tr><th>Когда</th><th>Сценарий</th><th>Роль</th><th>Время</th></tr></thead>'
      + '<tbody>' + rows + '</tbody></table></div>'
      + '</section>'
      + '<div class="results__actions">'
      + '<a class="btn btn--primary btn--lg" href="#/scenarios">Ещё одна тренировка, Алёночка?</a>'
      + '</div>'
      + '</div>';
  }

  /* ------------------------------------------------------------ Старт --- */

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})(window, document);

