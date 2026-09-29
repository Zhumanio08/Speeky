/*!
 * Speeky — общие утилиты (DOM, хранилище, форматирование, уведомления).
 * Подключается первым, экспортирует window.SpeekyUtils.
 */
(function (window, document) {
  'use strict';

  var STORAGE_PREFIX = 'speeky.v1.';

  /* ------------------------------------------------------------------ DOM --- */

  function $(selector, root) {
    return (root || document).querySelector(selector);
  }

  function $$(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function clear(node) {
    if (!node) return node;
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  function escapeHtml(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function on(node, event, handler, options) {
    if (!node) return function () {};
    node.addEventListener(event, handler, options);
    return function off() {
      node.removeEventListener(event, handler, options);
    };
  }

  /* ------------------------------------------------------- Форматирование --- */

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  /** 83 -> "01:23" */
  function formatClock(totalSeconds) {
    var seconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
    var minutes = Math.floor(seconds / 60);
    var rest = seconds % 60;
    return (minutes < 10 ? '0' : '') + minutes + ':' + (rest < 10 ? '0' : '') + rest;
  }

  /** Склонение по русским правилам: plural(5, ['тренировка','тренировки','тренировок']) */
  function plural(count, forms) {
    var n = Math.abs(Math.round(Number(count) || 0));
    var mod10 = n % 10;
    var mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return forms[0];
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1];
    return forms[2];
  }

  /** 83 -> "1 мин 23 сек" */
  function formatDurationText(totalSeconds) {
    var seconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
    if (seconds < 60) return seconds + ' ' + plural(seconds, ['секунда', 'секунды', 'секунд']);
    var minutes = Math.floor(seconds / 60);
    var rest = seconds % 60;
    var text = minutes + ' ' + plural(minutes, ['минута', 'минуты', 'минут']);
    if (rest > 0) text += ' ' + rest + ' ' + plural(rest, ['секунда', 'секунды', 'секунд']);
    return text;
  }

  /** 83 -> "1 мин 23 сек" — компактно и без падежных сложностей */
  function formatShort(totalSeconds) {
    var seconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
    if (seconds < 60) return seconds + ' сек';
    var minutes = Math.floor(seconds / 60);
    var rest = seconds % 60;
    return rest > 0 ? minutes + ' мин ' + rest + ' сек' : minutes + ' мин';
  }

  function isSameDay(first, second) {
    return first.getFullYear() === second.getFullYear()
      && first.getMonth() === second.getMonth()
      && first.getDate() === second.getDate();
  }

  function formatDate(timestamp) {
    var date = new Date(Number(timestamp) || Date.now());
    var day = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(date);
    var time = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(date);
    var today = new Date();
    if (isSameDay(date, today)) return 'сегодня, ' + time;
    if (isSameDay(date, new Date(today.getTime() - 86400000))) return 'вчера, ' + time;
    return day + ', ' + time;
  }

  function dayStamp(timestamp) {
    var date = new Date(Number(timestamp) || Date.now());
    return date.getFullYear() + '-' + (date.getMonth() + 1) + '-' + date.getDate();
  }

  /** Считает слова в распознанной речи. */
  function countWords(text) {
    if (!text) return 0;
    return String(text).trim().split(/[^\p{L}\p{N}'-]+/u).filter(Boolean).length;
  }

  function uid(prefix) {
    return (prefix || 'id') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  }

  /* -------------------------------------------------------- Коллекции/шум --- */

  function randomItem(list) {
    if (!list || !list.length) return null;
    return list[Math.floor(Math.random() * list.length)];
  }

  function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function shuffle(list) {
    var copy = list.slice();
    for (var i = copy.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = copy[i];
      copy[i] = copy[j];
      copy[j] = tmp;
    }
    return copy;
  }

  function debounce(fn, wait) {
    var timer = null;
    return function debounced() {
      var args = arguments;
      var context = this;
      window.clearTimeout(timer);
      timer = window.setTimeout(function () {
        fn.apply(context, args);
      }, wait || 150);
    };
  }

  /* ------------------------------------------------------------ Хранилище --- */

  var memoryFallback = {};

  function isStorageAvailable() {
    try {
      var probe = '__speeky_probe__';
      window.localStorage.setItem(probe, '1');
      window.localStorage.removeItem(probe);
      return true;
    } catch (error) {
      return false;
    }
  }

  function storageRead(key, fallback) {
    var fullKey = STORAGE_PREFIX + key;
    try {
      var raw = window.localStorage.getItem(fullKey);
      if (raw === null) return fallback;
      return JSON.parse(raw);
    } catch (error) {
      return fullKey in memoryFallback ? memoryFallback[fullKey] : fallback;
    }
  }

  function storageWrite(key, value) {
    var fullKey = STORAGE_PREFIX + key;
    memoryFallback[fullKey] = value;
    try {
      window.localStorage.setItem(fullKey, JSON.stringify(value));
      return true;
    } catch (error) {
      return false;
    }
  }

  function storageRemove(key) {
    var fullKey = STORAGE_PREFIX + key;
    delete memoryFallback[fullKey];
    try {
      window.localStorage.removeItem(fullKey);
    } catch (error) {
      /* хранилище недоступно — просто игнорируем */
    }
  }

  /* ------------------------------------------------------------ Анимации --- */

  function prefersReducedMotion() {
    return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function formatCountValue(value, settings) {
    if (settings && settings.format === 'time') return formatClock(value);
    if (settings && settings.format === 'duration') return formatDurationText(value);
    return String(value);
  }

  /** Плавно «докручивает» число в элементе (микровзаимодействие для счётчиков). */
  function animateCount(node, to, options) {
    if (!node) return;
    var settings = options || {};
    var duration = settings.duration || 700;
    var from = Number(node.dataset.value || settings.from || 0);
    var target = Number(to) || 0;
    var suffix = settings.suffix || '';

    if (prefersReducedMotion() || from === target) {
      node.dataset.value = String(target);
      node.textContent = formatCountValue(target, settings) + suffix;
      return;
    }

    var started = null;

    function step(timestamp) {
      if (started === null) started = timestamp;
      var progress = clamp((timestamp - started) / duration, 0, 1);
      var eased = 1 - Math.pow(1 - progress, 3);
      var current = Math.round(from + (target - from) * eased);
      node.dataset.value = String(current);
      node.textContent = formatCountValue(current, settings) + suffix;
      if (progress < 1) window.requestAnimationFrame(step);
    }

    window.requestAnimationFrame(step);
  }

  function rerunAnimation(node, className) {
    if (!node || prefersReducedMotion()) return;
    node.classList.remove(className);
    void node.offsetWidth; /* принудительный reflow, чтобы анимация перезапустилась */
    node.classList.add(className);
  }

  /* -------------------------------------------------------------- Диалоги --- */

  var TOAST_ICONS = { success: '✅', info: '💙', warn: '⚠️', error: '😔' };

  function notify(message, type, timeout) {
    var root = $('#toast-root');
    if (!root) return null;
    var variant = type || 'info';
    var toast = el('div', 'toast toast--' + variant);
    toast.innerHTML = '<span class="toast__icon" aria-hidden="true">'
      + (TOAST_ICONS[variant] || TOAST_ICONS.info)
      + '</span><span class="toast__text">' + escapeHtml(message) + '</span>';
    root.appendChild(toast);
    window.requestAnimationFrame(function () {
      toast.classList.add('is-visible');
    });
    window.setTimeout(function () {
      toast.classList.remove('is-visible');
      window.setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 320);
    }, timeout || 4200);
    return toast;
  }

  /* ------------------------------------------------- Возможности браузера --- */

  function getSpeechRecognition() {
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
  }

  function supportsSpeechRecognition() {
    return Boolean(getSpeechRecognition());
  }

  function supportsMediaRecorder() {
    return Boolean(window.MediaRecorder && window.navigator
      && window.navigator.mediaDevices
      && typeof window.navigator.mediaDevices.getUserMedia === 'function');
  }

  function createAudioContext() {
    var Ctor = window.AudioContext || window.webkitAudioContext;
    return Ctor ? new Ctor() : null;
  }

  function supportsAudioContext() {
    return Boolean(window.AudioContext || window.webkitAudioContext);
  }

  window.SpeekyUtils = {
    STORAGE_PREFIX: STORAGE_PREFIX,
    $: $,
    $$: $$,
    el: el,
    clear: clear,
    escapeHtml: escapeHtml,
    on: on,
    clamp: clamp,
    formatClock: formatClock,
    formatDurationText: formatDurationText,
    formatShort: formatShort,
    formatDate: formatDate,
    plural: plural,
    isSameDay: isSameDay,
    dayStamp: dayStamp,
    countWords: countWords,
    uid: uid,
    randomItem: randomItem,
    randomInt: randomInt,
    shuffle: shuffle,
    debounce: debounce,
    isStorageAvailable: isStorageAvailable,
    storage: { read: storageRead, write: storageWrite, remove: storageRemove },
    animateCount: animateCount,
    prefersReducedMotion: prefersReducedMotion,
    rerunAnimation: rerunAnimation,
    notify: notify,
    getSpeechRecognition: getSpeechRecognition,
    supportsSpeechRecognition: supportsSpeechRecognition,
    supportsMediaRecorder: supportsMediaRecorder,
    supportsAudioContext: supportsAudioContext,
    createAudioContext: createAudioContext
  };
})(window, document);
