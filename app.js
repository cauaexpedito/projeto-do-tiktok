const DB_NAME = 'ritmo-video-planner';
const DB_VERSION = 2;
const VIDEO_STORE = 'videos';
const POST_STORE = 'posts';
const SETTINGS_STORE = 'settings';
const AUTO_SETTING_ID = 'daily-automation';

const elements = {
  videoInput: document.querySelector('#video-input'),
  dropZone: document.querySelector('#drop-zone'),
  videoLibrary: document.querySelector('#video-library'),
  videoSelect: document.querySelector('#video-select'),
  videoCount: document.querySelector('#video-count'),
  libraryCount: document.querySelector('#library-count'),
  scheduledCount: document.querySelector('#scheduled-count'),
  nextPostValue: document.querySelector('#next-post-value'),
  nextPostFoot: document.querySelector('#next-post-foot'),
  scheduleForm: document.querySelector('#schedule-form'),
  scheduleButton: document.querySelector('#schedule-button'),
  dateInput: document.querySelector('#date-input'),
  timeInput: document.querySelector('#time-input'),
  captionInput: document.querySelector('#caption-input'),
  formMessage: document.querySelector('#form-message'),
  postQueue: document.querySelector('#post-queue'),
  queueCount: document.querySelector('#queue-count'),
  todayLabel: document.querySelector('#today-label'),
  toast: document.querySelector('#toast'),
  connectDialog: document.querySelector('#connect-dialog'),
  connectButton: document.querySelector('#connect-button'),
  connectLabel: document.querySelector('#connect-label'),
  connectionTitle: document.querySelector('#connection-title'),
  connectionMessage: document.querySelector('#connection-message'),
  connectionInfo: document.querySelector('#connection-info'),
  connectionAction: document.querySelector('#connection-action'),
  themeToggle: document.querySelector('#theme-toggle'),
  autoRate: document.querySelector('#auto-rate'),
  autoTime: document.querySelector('#auto-time'),
  autoSecondTime: document.querySelector('#auto-second-time'),
  autoSecondTimeField: document.querySelector('#auto-second-time-field'),
  autoStart: document.querySelector('#auto-start'),
  autoStop: document.querySelector('#auto-stop'),
  autoStatus: document.querySelector('#auto-status'),
  autoMessage: document.querySelector('#auto-message'),
};

let database;
let videos = [];
let posts = [];
let automaticRun = null;
let toastTimeout;
let tiktokConnection = { loading: true, configured: false, connected: false };

function updateThemeButton(theme) {
  const nextTheme = theme === 'dark' ? 'claro' : 'escuro';
  const label = `Ativar tema ${nextTheme}`;
  elements.themeToggle.setAttribute('aria-label', label);
  elements.themeToggle.title = label;
  elements.themeToggle.querySelector('.theme-label').textContent = `Modo ${nextTheme}`;
  document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#111512' : '#f7f7f5';
}

function setTheme(theme, persist = false) {
  document.documentElement.dataset.theme = theme;
  updateThemeButton(theme);
  if (!persist) return;

  try {
    localStorage.setItem('ritmo-theme', theme);
  } catch (error) {
    console.error('Falha ao salvar a preferência de tema:', error);
    showToast('O tema mudou, mas não foi possível salvar essa preferência.');
  }
}

function setUpThemeToggle() {
  let savedTheme = 'light';
  try {
    const preference = localStorage.getItem('ritmo-theme');
    if (preference === 'dark' || preference === 'light') savedTheme = preference;
  } catch (error) {
    console.error('Falha ao carregar a preferência de tema:', error);
  }
  setTheme(savedTheme);
  elements.themeToggle.addEventListener('click', () => {
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark', true);
  });
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(VIDEO_STORE)) {
        db.createObjectStore(VIDEO_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(POST_STORE)) {
        db.createObjectStore(POST_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Não foi possível abrir o armazenamento local.'));
  });
}

function getAll(storeName) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readonly');
    const request = transaction.objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Não foi possível ler os dados salvos.'));
  });
}

function getRecord(storeName, id) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readonly');
    const request = transaction.objectStore(storeName).get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Não foi possível ler a configuração salva.'));
  });
}

function putRecord(storeName, record) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).put(record);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Não foi possível salvar os dados.'));
    transaction.onabort = () => reject(transaction.error || new Error('O armazenamento local recusou a gravação.'));
  });
}

function deleteRecord(storeName, id) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Não foi possível remover os dados.'));
    transaction.onabort = () => reject(transaction.error || new Error('A remoção do armazenamento local foi cancelada.'));
  });
}

function saveAutomaticSequence(run, scheduledPosts) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([POST_STORE, SETTINGS_STORE], 'readwrite');
    const postStore = transaction.objectStore(POST_STORE);
    for (const post of scheduledPosts) postStore.put(post);
    transaction.objectStore(SETTINGS_STORE).put(run);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Não foi possível salvar a sequência diária.'));
    transaction.onabort = () => reject(transaction.error || new Error('O armazenamento local recusou a sequência diária.'));
  });
}

function deleteAutomaticSequence(postIds) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([POST_STORE, SETTINGS_STORE], 'readwrite');
    const postStore = transaction.objectStore(POST_STORE);
    for (const postId of postIds) postStore.delete(postId);
    transaction.objectStore(SETTINGS_STORE).delete(AUTO_SETTING_ID);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Não foi possível parar a sequência diária.'));
    transaction.onabort = () => reject(transaction.error || new Error('O cancelamento da sequência foi recusado.'));
  });
}

function createId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatFileSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatPostDate(value) {
  const date = new Date(value);
  return {
    day: new Intl.DateTimeFormat('pt-BR', { day: '2-digit' }).format(date),
    month: new Intl.DateTimeFormat('pt-BR', { month: 'short' }).format(date).replace('.', ''),
    full: new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' }).format(date),
  };
}

function getLocalDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function setTodayLabel() {
  elements.todayLabel.textContent = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date()).replace('.', '');
}

function setMinimumScheduleDate() {
  const now = new Date();
  const localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  elements.dateInput.min = localDate;
  elements.dateInput.value = localDate;
  const roundedMinutes = Math.ceil(now.getMinutes() / 5) * 5;
  const roundedDate = new Date(now);
  roundedDate.setMinutes(roundedMinutes, 0, 0);
  if (roundedDate.getDate() !== now.getDate()) {
    elements.timeInput.value = '09:00';
  } else {
    elements.timeInput.value = `${String(roundedDate.getHours()).padStart(2, '0')}:${String(roundedDate.getMinutes()).padStart(2, '0')}`;
  }
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add('visible');
  window.clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => elements.toast.classList.remove('visible'), 3200);
}

function createThumbnail(video, className = '') {
  const wrapper = document.createElement('span');
  wrapper.className = `video-thumb ${className}`.trim();
  const preview = document.createElement('video');
  if (!video.objectUrl) video.objectUrl = URL.createObjectURL(video.blob);
  preview.src = video.objectUrl;
  preview.muted = true;
  preview.preload = 'metadata';
  preview.setAttribute('aria-label', `Prévia de ${video.name}`);
  wrapper.append(preview);
  return wrapper;
}

function renderVideos() {
  elements.videoCount.textContent = videos.length;
  elements.libraryCount.textContent = videos.length;
  elements.videoLibrary.replaceChildren();

  if (videos.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-library';
    const icon = document.createElement('span');
    icon.className = 'empty-play';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '▶';
    const text = document.createElement('span');
    text.textContent = 'Seus vídeos aparecerão aqui';
    empty.append(icon, text);
    elements.videoLibrary.append(empty);
    elements.videoSelect.replaceChildren(new Option('Adicione um vídeo primeiro', ''));
    elements.scheduleButton.disabled = true;
    renderAutomation();
    return;
  }

  for (const video of videos) {
    const item = document.createElement('div');
    item.className = 'video-item';
    item.append(createThumbnail(video));

    const copy = document.createElement('div');
    copy.className = 'video-copy';
    const name = document.createElement('strong');
    name.textContent = video.name;
    name.title = video.name;
    const size = document.createElement('span');
    size.textContent = formatFileSize(video.size);
    copy.append(name, size);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove-video';
    remove.setAttribute('aria-label', `Remover ${video.name}`);
    remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M5.5 7l1 13h11l1-13M9 7V4h6v3"/></svg>';
    remove.addEventListener('click', () => removeVideo(video.id));
    item.append(copy, remove);
    elements.videoLibrary.append(item);
  }

  const selectedId = elements.videoSelect.value;
  elements.videoSelect.replaceChildren(new Option('Selecione um vídeo', ''));
  for (const video of videos) {
    const option = new Option(video.name, video.id);
    option.title = video.name;
    elements.videoSelect.add(option);
  }
  if (videos.some(video => video.id === selectedId)) {
    elements.videoSelect.value = selectedId;
  }
  elements.scheduleButton.disabled = false;
  renderAutomation();
}

function renderAutomation() {
  const runPosts = automaticRun
    ? posts
      .filter(post => post.automationId === automaticRun.runId)
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
    : [];
  const isActive = runPosts.length > 0;
  elements.autoStart.hidden = isActive;
  elements.autoStop.hidden = !isActive;
  elements.autoStart.disabled = videos.length === 0;
  updateAutoRateFields(isActive);
  elements.autoTime.disabled = isActive;
  const dailyRate = automaticRun ? automaticRun.dailyRate || 1 : Number(elements.autoRate.value);
  elements.autoStatus.textContent = isActive ? `${dailyRate}/dia na fila` : 'Desativada';
  elements.autoStatus.classList.toggle('is-active', isActive);

  if (!isActive) {
    elements.autoMessage.textContent = Number(elements.autoRate.value) === 2
      ? 'Escolha dois horários em ordem: o Horário 2 deve ser depois do Horário 1. As datas são organizadas automaticamente.'
      : 'Escolha o horário diário. As datas são organizadas automaticamente; a sequência agenda cada vídeo uma vez.';
    return;
  }

  const next = new Date(runPosts[0].scheduledAt);
  const nextDate = formatPostDate(runPosts[0].scheduledAt);
  const nextTime = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(next);
  elements.autoMessage.textContent = `${runPosts.length} vídeo(s) na fila (${dailyRate} por dia). Próximo: ${nextDate.full}, às ${nextTime}. Parar cancela os agendamentos desta sequência.`;
}

function updateAutoRateFields(isActive = Boolean(automaticRun)) {
  const needsSecondTime = elements.autoRate.value === '2';
  elements.autoSecondTimeField.hidden = !needsSecondTime;
  elements.autoSecondTime.required = needsSecondTime;
  elements.autoRate.disabled = isActive;
  elements.autoSecondTime.disabled = isActive;
}

function renderQueue() {
  const sortedPosts = [...posts].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  elements.scheduledCount.textContent = sortedPosts.length;
  elements.queueCount.textContent = sortedPosts.length;
  elements.postQueue.replaceChildren();

  if (sortedPosts.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'queue-empty';
    const icon = document.createElement('span');
    icon.className = 'queue-empty-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3.5v3M16 3.5v3M4 9.5h16"/></svg>';
    const title = document.createElement('strong');
    title.textContent = 'Sua fila está esperando pelo primeiro vídeo';
    const subtitle = document.createElement('span');
    subtitle.textContent = 'Escolha um vídeo e defina quando quer postar.';
    empty.append(icon, title, subtitle);
    elements.postQueue.append(empty);
    elements.nextPostValue.textContent = 'Tudo tranquilo';
    elements.nextPostFoot.textContent = 'Adicione um vídeo à fila';
    renderAutomation();
    return;
  }

  const next = new Date(sortedPosts[0].scheduledAt);
  elements.nextPostValue.textContent = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short' }).format(next).replace('.', '');
  elements.nextPostFoot.textContent = `às ${new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(next)}`;

  for (const post of sortedPosts) {
    const video = videos.find(item => item.id === post.videoId);
    const item = document.createElement('article');
    item.className = 'queue-item';
    const main = document.createElement('div');
    main.className = 'queue-main';
    const date = formatPostDate(post.scheduledAt);
    const dateBlock = document.createElement('div');
    dateBlock.className = 'queue-date';
    const day = document.createElement('strong');
    day.textContent = date.day;
    const month = document.createElement('span');
    month.textContent = date.month;
    dateBlock.append(day, month);
    main.append(dateBlock);

    if (video) {
      main.append(createThumbnail(video, 'queue-thumb'));
    } else {
      const missing = document.createElement('span');
      missing.className = 'video-thumb queue-thumb';
      missing.textContent = '▶';
      main.append(missing);
    }

    const copy = document.createElement('div');
    copy.className = 'queue-copy';
    const title = document.createElement('strong');
    title.textContent = video ? video.name : 'Vídeo removido da biblioteca';
    title.title = title.textContent;
    const subtitle = document.createElement('span');
    subtitle.textContent = post.caption || 'Sem legenda';
    copy.append(title, subtitle);
    main.append(copy);

    const meta = document.createElement('div');
    meta.className = 'queue-meta';
    const time = document.createElement('span');
    time.className = 'queue-time';
    time.textContent = `${date.full} · ${new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(post.scheduledAt))}`;
    const status = document.createElement('span');
    status.className = 'queue-status';
    status.textContent = post.automationId ? 'Automático' : 'Na fila';
    if (post.automationId) status.classList.add('auto-queue-status');
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove-post';
    remove.setAttribute('aria-label', `Remover agendamento de ${title.textContent}`);
    remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M5.5 7l1 13h11l1-13M9 7V4h6v3"/></svg>';
    remove.addEventListener('click', () => {
      removePost(post.id).catch(error => {
        console.error('Falha ao remover agendamento:', error);
        showToast('Não foi possível remover o agendamento. Tente novamente.');
      });
    });
    meta.append(time, status, remove);
    item.append(main, meta);
    elements.postQueue.append(item);
  }
  renderAutomation();
}

async function addVideos(fileList) {
  const files = Array.from(fileList);
  const validFiles = files.filter(file => file.type.startsWith('video/'));
  const invalidCount = files.length - validFiles.length;
  if (invalidCount > 0) showToast(`${invalidCount} arquivo(s) ignorado(s): selecione apenas vídeos.`);
  if (validFiles.length === 0) return;

  const latestAddedAt = videos.reduce((latest, video) => {
    const addedAt = Date.parse(video.addedAt);
    return Number.isNaN(addedAt) ? latest : Math.max(latest, addedAt);
  }, Date.now());
  const added = [];
  for (const [index, file] of validFiles.entries()) {
    const video = {
      id: createId(),
      name: file.name,
      size: file.size,
      type: file.type || 'video/mp4',
      addedAt: new Date(latestAddedAt + index + 1).toISOString(),
      blob: file,
    };
    await putRecord(VIDEO_STORE, video);
    added.push(video);
  }
  videos.push(...added);
  renderVideos();
  elements.videoSelect.value = added[0].id;
  showToast(`${added.length} vídeo(s) adicionado(s) à biblioteca.`);
}

async function removeVideo(videoId) {
  const hasScheduledPost = posts.some(post => post.videoId === videoId);
  if (hasScheduledPost) {
    showToast('Remova os agendamentos deste vídeo antes de excluí-lo.');
    return;
  }
  await deleteRecord(VIDEO_STORE, videoId);
  const video = videos.find(item => item.id === videoId);
  if (video && video.objectUrl) URL.revokeObjectURL(video.objectUrl);
  videos = videos.filter(video => video.id !== videoId);
  renderVideos();
  renderQueue();
  showToast('Vídeo removido da biblioteca.');
}

async function removePost(postId) {
  const removedPost = posts.find(post => post.id === postId);
  const isLastAutomaticPost = removedPost
    && automaticRun
    && removedPost.automationId === automaticRun.runId
    && !posts.some(post => post.id !== postId && post.automationId === automaticRun.runId);
  if (isLastAutomaticPost) {
    await deleteAutomaticSequence([postId]);
    automaticRun = null;
  } else {
    await deleteRecord(POST_STORE, postId);
  }
  posts = posts.filter(post => post.id !== postId);
  renderQueue();
  showToast('Agendamento removido da fila.');
}

async function startAutomaticSequence() {
  if (automaticRun) return;
  elements.autoMessage.textContent = '';
  if (!elements.autoTime.value) {
    elements.autoMessage.textContent = 'Escolha o primeiro horário para continuar.';
    return;
  }

  const dailyRate = Number(elements.autoRate.value);
  const timeSlots = [elements.autoTime.value];
  if (dailyRate === 2) {
    if (!elements.autoSecondTime.value) {
      elements.autoMessage.textContent = 'Escolha o horário do segundo vídeo.';
      return;
    }
    if (elements.autoSecondTime.value <= elements.autoTime.value) {
      elements.autoMessage.textContent = 'O Horário 2 precisa ser depois do Horário 1.';
      return;
    }
    timeSlots.push(elements.autoSecondTime.value);
  }

  const queuedVideoIds = new Set(posts.map(post => post.videoId));
  const candidates = [...videos]
    .sort((a, b) => a.addedAt.localeCompare(b.addedAt) || a.id.localeCompare(b.id))
    .filter(video => !queuedVideoIds.has(video.id));
  if (candidates.length === 0) {
    elements.autoMessage.textContent = 'Todos os vídeos da biblioteca já estão na fila. Adicione vídeos novos ou remova um agendamento para iniciar outra sequência.';
    return;
  }

  const now = new Date();
  const existingByDate = new Map();
  for (const post of posts) {
    const date = new Date(post.scheduledAt);
    const dateKey = getLocalDateKey(date);
    const postTimes = existingByDate.get(dateKey) || [];
    postTimes.push(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date));
    existingByDate.set(dateKey, postTimes);
  }

  const runId = createId();
  const scheduledPosts = [];
  const firstDate = new Date(now);
  firstDate.setHours(0, 0, 0, 0);
  let dateOffset = 0;
  let candidateIndex = 0;
  while (candidateIndex < candidates.length) {
    const scheduleDate = new Date(firstDate);
    scheduleDate.setDate(scheduleDate.getDate() + dateOffset);
    const dateKey = getLocalDateKey(scheduleDate);
    const existingTimes = existingByDate.get(dateKey) || [];
    const usedTimes = new Set(existingTimes);
    let dailyCount = existingTimes.length;

    for (const time of timeSlots) {
      if (dailyCount >= dailyRate || candidateIndex >= candidates.length) break;
      if (usedTimes.has(time)) continue;

      const [hours, minutes] = time.split(':').map(Number);
      const scheduledAt = new Date(scheduleDate);
      scheduledAt.setHours(hours, minutes, 0, 0);
      if (scheduledAt <= now) continue;

      const video = candidates[candidateIndex];
      scheduledPosts.push({
        id: createId(),
        videoId: video.id,
        caption: '',
        scheduledAt: scheduledAt.toISOString(),
        createdAt: now.toISOString(),
        automationId: runId,
      });
      usedTimes.add(time);
      dailyCount += 1;
      candidateIndex += 1;
    }
    existingByDate.set(dateKey, [...usedTimes]);
    dateOffset += 1;
  }

  const run = {
    id: AUTO_SETTING_ID,
    runId,
    time: elements.autoTime.value,
    dailyRate,
    times: timeSlots,
    startedAt: now.toISOString(),
    totalPosts: scheduledPosts.length,
  };
  await saveAutomaticSequence(run, scheduledPosts);
  automaticRun = run;
  posts.push(...scheduledPosts);
  renderQueue();
  showToast(`${scheduledPosts.length} vídeo(s) adicionado(s) à sequência diária.`);
}

async function stopAutomaticSequence() {
  if (!automaticRun) return;
  const runId = automaticRun.runId;
  const runPostIds = posts
    .filter(post => post.automationId === runId)
    .map(post => post.id);
  await deleteAutomaticSequence(runPostIds);
  posts = posts.filter(post => post.automationId !== runId);
  automaticRun = null;
  renderQueue();
  showToast('Sequência parada; os agendamentos automáticos foram cancelados.');
}

function getScheduledTimestamp() {
  if (!elements.dateInput.value || !elements.timeInput.value) return null;
  const scheduledAt = new Date(`${elements.dateInput.value}T${elements.timeInput.value}`);
  if (Number.isNaN(scheduledAt.getTime())) return null;
  return scheduledAt;
}

async function schedulePost(event) {
  event.preventDefault();
  elements.formMessage.textContent = '';
  elements.formMessage.classList.remove('success');

  const video = videos.find(item => item.id === elements.videoSelect.value);
  if (!video) {
    elements.formMessage.textContent = 'Escolha um vídeo da sua biblioteca.';
    return;
  }

  const scheduledAt = getScheduledTimestamp();
  if (!scheduledAt || scheduledAt <= new Date()) {
    elements.formMessage.textContent = 'Escolha um horário futuro para agendar.';
    return;
  }

  const post = {
    id: createId(),
    videoId: video.id,
    caption: elements.captionInput.value.trim(),
    scheduledAt: scheduledAt.toISOString(),
    createdAt: new Date().toISOString(),
  };
  await putRecord(POST_STORE, post);
  posts.push(post);
  renderQueue();
  elements.captionInput.value = '';
  elements.formMessage.textContent = 'Adicionado à sua fila de conteúdo.';
  elements.formMessage.classList.add('success');
  showToast('Vídeo agendado com sucesso.');
}

function setUpUpload() {
  elements.videoInput.addEventListener('change', async event => {
    try {
      await addVideos(event.target.files);
    } catch (error) {
      console.error('Falha ao adicionar vídeos:', error);
      showToast('Não foi possível salvar os vídeos. Verifique o espaço disponível no navegador.');
    } finally {
      elements.videoInput.value = '';
    }
  });

  for (const eventName of ['dragenter', 'dragover']) {
    elements.dropZone.addEventListener(eventName, event => {
      event.preventDefault();
      elements.dropZone.classList.add('drag-over');
    });
  }
  for (const eventName of ['dragleave', 'drop']) {
    elements.dropZone.addEventListener(eventName, event => {
      event.preventDefault();
      elements.dropZone.classList.remove('drag-over');
    });
  }
  elements.dropZone.addEventListener('drop', async event => {
    try {
      await addVideos(event.dataTransfer.files);
    } catch (error) {
      console.error('Falha ao adicionar vídeos:', error);
      showToast('Não foi possível salvar os vídeos. Verifique o espaço disponível no navegador.');
    }
  });
}

function setUpConnectionDialog() {
  elements.connectButton.addEventListener('click', () => {
    renderConnectionDialog();
    elements.connectDialog.showModal();
  });
  document.querySelector('#close-dialog').addEventListener('click', () => elements.connectDialog.close());
  document.querySelector('#dialog-ok').addEventListener('click', () => elements.connectDialog.close());
  elements.connectionAction.addEventListener('click', async () => {
    if (tiktokConnection.connected) {
      elements.connectionAction.disabled = true;
      try {
        const response = await fetch('/api/tiktok/disconnect', {
          method: 'POST',
          headers: { 'X-Requested-With': 'Ritmo' },
        });
        if (!response.ok) throw new Error(`Desconexão recusada (HTTP ${response.status}).`);
        await response.json();
        await refreshTikTokStatus();
        elements.connectDialog.close();
        showToast('Conta TikTok desconectada.');
      } catch (error) {
        console.error('Falha ao desconectar o TikTok:', error);
        showToast('Não foi possível desconectar a conta TikTok. Tente novamente.');
      } finally {
        elements.connectionAction.disabled = false;
        renderConnectionDialog();
      }
      return;
    }

    if (tiktokConnection.configured) window.location.assign('/auth/tiktok');
  });
  elements.connectDialog.addEventListener('click', event => {
    if (event.target === elements.connectDialog) elements.connectDialog.close();
  });
}

function renderConnectionDialog() {
  const infoText = elements.connectionInfo.querySelectorAll('span')[1];
  elements.connectionAction.hidden = true;
  elements.connectButton.classList.remove('is-connected');
  elements.connectButton.removeAttribute('aria-label');

  if (tiktokConnection.loading) {
    elements.connectLabel.textContent = 'Verificando TikTok';
    elements.connectionTitle.textContent = 'Verificando conexão';
    elements.connectionMessage.textContent = 'Aguarde enquanto verificamos a conexão segura com o TikTok.';
    infoText.textContent = 'Os tokens de acesso são mantidos apenas no servidor.';
    return;
  }

  if (tiktokConnection.unavailable) {
    elements.connectLabel.textContent = 'TikTok indisponível';
    elements.connectionTitle.textContent = 'Servidor indisponível';
    elements.connectionMessage.textContent = 'Não foi possível verificar a conexão. Inicie o app com node server.js e tente novamente.';
    infoText.textContent = 'A conexão precisa do servidor Ritmo em execução.';
    return;
  }

  if (!tiktokConnection.configured) {
    elements.connectLabel.textContent = 'Configurar TikTok';
    elements.connectionTitle.textContent = 'Configure o servidor';
    elements.connectionMessage.textContent = 'Para conectar sua conta, configure as credenciais do TikTok no arquivo .env do servidor.';
    infoText.textContent = `Configuração necessária: ${(tiktokConnection.missing || []).join(', ') || 'credenciais do TikTok'}.`;
    return;
  }

  if (tiktokConnection.connected) {
    elements.connectLabel.textContent = 'TikTok conectado';
    elements.connectButton.classList.add('is-connected');
    elements.connectButton.setAttribute('aria-label', `TikTok conectado: ${tiktokConnection.account.displayName}`);
    elements.connectionTitle.textContent = 'Conta conectada';
    elements.connectionMessage.textContent = `A conta ${tiktokConnection.account.displayName} foi autorizada pelo TikTok.`;
    infoText.textContent = tiktokConnection.canPublish
      ? 'Escopo de publicação autorizado. O envio dos vídeos pela API ainda precisa ser implementado.'
      : 'A conta foi conectada, mas o TikTok não concedeu o escopo video.publish.';
    elements.connectionAction.textContent = 'Desconectar TikTok';
    elements.connectionAction.hidden = false;
    return;
  }

  elements.connectLabel.textContent = 'Conectar TikTok';
  elements.connectionTitle.textContent = 'Conecte sua conta';
  elements.connectionMessage.textContent = 'A conexão usa a autorização oficial do TikTok. Suas credenciais ficam no servidor, nunca no navegador.';
  infoText.textContent = 'Você autoriza o acesso diretamente na página do TikTok.';
  elements.connectionAction.textContent = 'Conectar com TikTok';
  elements.connectionAction.hidden = false;
}

async function refreshTikTokStatus() {
  tiktokConnection = { loading: true, configured: false, connected: false };
  renderConnectionDialog();
  try {
    const response = await fetch('/api/tiktok/status', { cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok) throw new Error(`Consulta de conexão recusada (HTTP ${response.status}).`);
    tiktokConnection = { loading: false, ...payload };
  } catch (error) {
    console.error('Falha ao consultar o status do TikTok:', error);
    tiktokConnection = { loading: false, unavailable: true, configured: false, connected: false };
  }
  renderConnectionDialog();
}

function showTikTokReturnMessage() {
  const currentUrl = new URL(window.location.href);
  const result = currentUrl.searchParams.get('tiktok');
  if (!result) return;

  const messages = {
    connected: 'Conta TikTok conectada com sucesso.',
    denied: 'A autorização do TikTok foi cancelada.',
    invalid_state: 'Não foi possível validar a autorização. Tente conectar novamente.',
    error: 'Não foi possível concluir a conexão com o TikTok.',
    setup: 'Configure o servidor Ritmo antes de conectar o TikTok.',
  };
  if (messages[result]) showToast(messages[result]);
  currentUrl.searchParams.delete('tiktok');
  window.history.replaceState(null, '', `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`);
}

function setUpNavigation() {
  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', () => {
      document.querySelectorAll('.nav-link').forEach(item => item.classList.remove('active'));
      link.classList.add('active');
    });
  });
}

function setUpAutomaticSequence() {
  elements.autoTime.value = elements.timeInput.value;
  elements.autoRate.addEventListener('change', () => renderAutomation());
  updateAutoRateFields(false);
  elements.autoStart.addEventListener('click', () => {
    startAutomaticSequence().catch(error => {
      console.error('Falha ao iniciar a sequência diária:', error);
      elements.autoMessage.textContent = 'Não foi possível iniciar a sequência. Tente novamente.';
    });
  });
  elements.autoStop.addEventListener('click', () => {
    stopAutomaticSequence().catch(error => {
      console.error('Falha ao parar a sequência diária:', error);
      elements.autoMessage.textContent = 'Não foi possível cancelar a sequência. Tente novamente.';
    });
  });
}

async function init() {
  setTodayLabel();
  setMinimumScheduleDate();
  setUpThemeToggle();
  setUpNavigation();
  setUpUpload();
  setUpConnectionDialog();
  showTikTokReturnMessage();
  await refreshTikTokStatus();
  setUpAutomaticSequence();
  elements.scheduleForm.addEventListener('submit', event => {
    schedulePost(event).catch(error => {
      console.error('Falha ao agendar vídeo:', error);
      elements.formMessage.textContent = 'Não foi possível salvar o agendamento. Tente novamente.';
    });
  });
  try {
    database = await openDatabase();
    [videos, posts, automaticRun] = await Promise.all([
      getAll(VIDEO_STORE),
      getAll(POST_STORE),
      getRecord(SETTINGS_STORE, AUTO_SETTING_ID),
    ]);
    if (automaticRun) {
      elements.autoRate.value = automaticRun.dailyRate === 2 ? '2' : '1';
      elements.autoTime.value = automaticRun.times && automaticRun.times[0]
        ? automaticRun.times[0]
        : automaticRun.time || elements.autoTime.value;
      elements.autoSecondTime.value = automaticRun.times && automaticRun.times[1] || '';
    }
    videos.sort((a, b) => a.addedAt.localeCompare(b.addedAt) || a.id.localeCompare(b.id));
    if (automaticRun && !posts.some(post => post.automationId === automaticRun.runId)) {
      await deleteRecord(SETTINGS_STORE, AUTO_SETTING_ID);
      automaticRun = null;
    }
    renderVideos();
    renderQueue();
  } catch (error) {
    console.error('Falha ao iniciar o armazenamento local:', error);
    showToast('Não foi possível acessar o armazenamento local deste navegador.');
    elements.scheduleButton.disabled = true;
  }
}

init();
