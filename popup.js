const $ = id => document.getElementById(id);

const elChannel = $('channel-id');
const elGuild = $('guild-id');
const btnServer = $('mode-server');
const btnDm = $('mode-dm');
const sliderDelay = $('delay-slider');
const txtDelay = $('delay-value');
const inpCount = $('delete-count');
const chkAll = $('delete-all-checkbox');
const chkAllServer = $('delete-all-server-checkbox');
const btnStart = $('start-delete-btn');
const btnStop = $('stop-delete-btn');
const elFrom = $('delete-from');
const elUntil = $('delete-until');
const btnOrderDesc = $('order-desc');
const btnOrderAsc = $('order-asc');
const txtStatus = $('status-text');
const barProgress = $('progress-indicator');

const txtError = $('error-console-output');
const btnCopyErr = $('copy-error-btn');
const btnClearErr = $('clear-error-btn');

const langSelector = $('lang-selector');
const langMenu = $('lang-menu');
const currentFlag = $('current-flag');
const langOptions = document.querySelectorAll('.lang-menu li');

let running = false;
let mode = 'server';
let order = 'desc';
let currentLang = 'es';
let translations = {};

chrome.storage.local.get(['mode', 'delay', 'count', 'deleteAll', 'deleteAllServer', 'channelId', 'guildId', 'fromId', 'untilId', 'order', 'language'], (res) => {
    if (res.mode === 'dm') {
        mode = 'dm';
        btnDm.classList.add('toggle-active');
        btnServer.classList.remove('toggle-active');
    }

    if (res.channelId && elChannel) elChannel.value = res.channelId;
    if (res.guildId && elGuild) elGuild.value = res.guildId;
    if (res.fromId) elFrom.value = res.fromId;
    if (res.untilId) elUntil.value = res.untilId;

    if (res.order === 'asc') {
        order = 'asc';
        btnOrderAsc.classList.add('toggle-active');
        btnOrderDesc.classList.remove('toggle-active');
    }

    if (res.delay) {
        sliderDelay.value = res.delay;
        txtDelay.textContent = `${res.delay} ms`;
    }

    if (res.count) inpCount.value = res.count;

    if (res.deleteAll !== undefined) {
        chkAll.checked = res.deleteAll;
        inpCount.disabled = res.deleteAll;
        const container = chkAll.closest('.checkbox-container');
        if (res.deleteAll) container.classList.add('danger-active');
    }

    if (res.deleteAllServer !== undefined) {
        chkAllServer.checked = res.deleteAllServer;
        const container = chkAllServer.closest('.checkbox-container');
        if (res.deleteAllServer) container.classList.add('danger-active');
    }

    if (res.language) {
        currentLang = res.language;
    }
    loadLanguage(currentLang).then(() => {
        updateFormState();
        updateUI(mode);
    });
});

async function loadLanguage(lang) {
    try {
        const response = await fetch(`lang/${lang}.json`);
        translations = await response.json();
        applyTranslations();
        
        const flagMap = { 'es': '🇪🇸', 'pt': '🇵🇹', 'en': '🇺🇸', 'fr': '🇫🇷', 'ja': '🇯🇵', 'de': '🇩🇪', 'hi': '🇮🇳' };
        if (currentFlag) currentFlag.textContent = flagMap[lang] || '🌐';
        
        currentLang = lang;
        chrome.storage.local.set({ language: lang });
        document.getElementById('html-doc').lang = lang.split('-')[0];
    } catch (e) {
        console.error("Error loading language:", e);
    }
}

function applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (translations[key]) el.textContent = translations[key];
    });
    document.querySelectorAll('[data-i18n-ph]').forEach(el => {
        const key = el.getAttribute('data-i18n-ph');
        if (translations[key]) el.placeholder = translations[key];
    });
}

function t(key, replacements = {}) {
    let text = translations[key] || key;
    for (const [k, v] of Object.entries(replacements)) {
        text = text.replace(`{${k}}`, v);
    }
    return text;
}

langSelector.addEventListener('click', () => {
    langMenu.classList.toggle('hidden');
});

langOptions.forEach(opt => {
    opt.addEventListener('click', (e) => {
        const lang = e.currentTarget.getAttribute('data-lang');
        loadLanguage(lang);
    });
});

document.addEventListener('click', (e) => {
    if (!langSelector.contains(e.target)) {
        langMenu.classList.add('hidden');
    }
});


function updateFormState() {
    if (running) return;

    const rangeIsUsed = elFrom.value.trim() !== '' || elUntil.value.trim() !== '';
    const bothRangeIds = elFrom.value.trim() !== '' && elUntil.value.trim() !== '';
    const allIsChecked = chkAll.checked;
    const isDmMode = mode === 'dm';
    const guildIdIsSet = elGuild.value.trim() !== '';

    // Lógica para el checkbox "Borrar Todo (Servidor)"
    chkAllServer.disabled = !guildIdIsSet || isDmMode || rangeIsUsed;

    // Si se deshabilita mientras está marcado, desmarcarlo
    if (chkAllServer.disabled && chkAllServer.checked) {
        chkAllServer.checked = false;
        const container = chkAllServer.closest('.checkbox-container');
        container.classList.remove('danger-active');
        chrome.storage.local.set({ deleteAllServer: false });
    }

    if (chkAllServer.checked) {
        // Si "Borrar Todo (Servidor)" está activo, deshabilita casi todo lo demás
        elChannel.disabled = true;
        elGuild.disabled = false;
        inpCount.disabled = true;
        chkAll.disabled = true;
        elFrom.disabled = true;
        elUntil.disabled = true;
        btnOrderAsc.disabled = true;
        btnOrderDesc.disabled = true;
    } else {
        // Lógica normal si "Borrar Todo (Servidor)" no está activo
        elChannel.disabled = false;
        elGuild.disabled = elChannel.value.trim() !== '' || isDmMode;
        
        inpCount.disabled = rangeIsUsed || allIsChecked;
        chkAll.disabled = rangeIsUsed;
        
        elFrom.disabled = allIsChecked;
        elUntil.disabled = allIsChecked;
        
        btnOrderAsc.disabled = bothRangeIds;
        btnOrderDesc.disabled = bothRangeIds;
    }
}

function updateUI(m) {
    const isDm = m === 'dm';
    if (chkAllServer) {
        if (isDm && chkAllServer.checked) {
            chkAllServer.checked = false;
            chrome.storage.local.set({ deleteAllServer: false });
            const container = chkAllServer.closest('.checkbox-container');
            if (container) container.classList.remove('danger-active');
        }
    }
    updateFormState();
}

btnServer.addEventListener('click', () => {
    if (mode !== 'server') {
        mode = 'server';
        btnServer.classList.add('toggle-active');
        btnDm.classList.remove('toggle-active');
        chrome.storage.local.set({ mode: 'server' });
        updateUI('server');
    }
});

btnDm.addEventListener('click', () => {
    if (mode !== 'dm') {
        mode = 'dm';
        btnDm.classList.add('toggle-active');
        btnServer.classList.remove('toggle-active');
        chrome.storage.local.set({ mode: 'dm' });
        updateUI('dm');
    }
});

sliderDelay.addEventListener('input', () => {
    txtDelay.textContent = `${sliderDelay.value} ms`;
    chrome.storage.local.set({ delay: sliderDelay.value });
});

inpCount.addEventListener('input', () => {
    chrome.storage.local.set({ count: inpCount.value });
});

elChannel.addEventListener('input', () => {
    chrome.storage.local.set({ channelId: elChannel.value });
    updateFormState();
});

if (elGuild) {
    elGuild.addEventListener('input', () => {
        chrome.storage.local.set({ guildId: elGuild.value });
        updateFormState();
    });
}

elFrom.addEventListener('input', () => {
    chrome.storage.local.set({ fromId: elFrom.value });
    updateFormState();
});

elUntil.addEventListener('input', () => {
    chrome.storage.local.set({ untilId: elUntil.value });
    updateFormState();
});

btnOrderDesc.addEventListener('click', () => {
    if (order !== 'desc') {
        order = 'desc';
        btnOrderDesc.classList.add('toggle-active');
        btnOrderAsc.classList.remove('toggle-active');
        chrome.storage.local.set({ order: 'desc' });
    }
});

btnOrderAsc.addEventListener('click', () => {
    if (order !== 'asc') {
        order = 'asc';
        btnOrderAsc.classList.add('toggle-active');
        btnOrderDesc.classList.remove('toggle-active');
        chrome.storage.local.set({ order: 'asc' });
    }
});

chkAll.addEventListener('change', () => {
    updateFormState();
    const container = chkAll.closest('.checkbox-container');
    if (chkAll.checked) {
        container.classList.add('danger-active');
    } else {
        container.classList.remove('danger-active');
    }
    chrome.storage.local.set({ deleteAll: chkAll.checked });
});

chkAllServer.addEventListener('change', () => {
    const container = chkAllServer.closest('.checkbox-container');
    if (chkAllServer.checked) {
        // Limpiar otros campos para evitar conflictos
        elChannel.value = '';
        elFrom.value = '';
        elUntil.value = '';
        if (chkAll.checked) {
            chkAll.checked = false;
            chkAll.closest('.checkbox-container').classList.remove('danger-active');
        }
        
        chrome.storage.local.set({ 
            deleteAllServer: true,
            channelId: '',
            fromId: '',
            untilId: '',
            deleteAll: false
        });
        container.classList.add('danger-active');
    } else {
        container.classList.remove('danger-active');
        chrome.storage.local.set({ deleteAllServer: false });
    }
    updateFormState();
});

btnCopyErr.addEventListener('click', () => {
    navigator.clipboard.writeText(txtError.textContent);
    btnCopyErr.textContent = t('btn_copied');
    setTimeout(() => { btnCopyErr.textContent = t('btn_copy'); }, 2000);
});

btnClearErr.addEventListener('click', () => {
    txtError.textContent = '';
});

btnStart.addEventListener('click', async () => {
    const settings = {
        channelId: elChannel.value.trim(),
        guildId: elGuild ? elGuild.value.trim() : null,
        mode: mode,
        delay: parseInt(sliderDelay.value, 10),
        count: chkAll.checked ? -1 : parseInt(inpCount.value, 10),
        deleteAllServer: chkAllServer.checked,
        fromId: elFrom.value.trim(),
        untilId: elUntil.value.trim(),
        order: order,
        i18n: {
            bg_err_running: t('bg_err_running'),
            bg_status_creds: t('bg_status_creds'),
            bg_err_server_mode_dm: t('bg_err_server_mode_dm'),
            bg_err_no_guild: t('bg_err_no_guild'),
            bg_status_get_channels: t('bg_status_get_channels'),
            bg_status_found_channels: t('bg_status_found_channels'),
            bg_status_server_done: t('bg_status_server_done'),
            bg_err_no_channel: t('bg_err_no_channel'),
            bg_status_done: t('bg_status_done'),
            bg_err_unknown: t('bg_err_unknown'),
            bg_status_searching_in: t('bg_status_searching_in'),
            bg_status_searching: t('bg_status_searching'),
            bg_status_no_msgs: t('bg_status_no_msgs'),
            bg_status_deleting_in: t('bg_status_deleting_in'),
            bg_status_deleting: t('bg_status_deleting'),
            bg_err_no_perms_channels: t('bg_err_no_perms_channels'),
            bg_err_get_channels: t('bg_err_get_channels'),
            bg_status_fetching: t('bg_status_fetching'),
            bg_status_ratelimit: t('bg_status_ratelimit'),
            bg_err_get_msgs: t('bg_err_get_msgs'),
            bg_status_fetching_range: t('bg_status_fetching_range'),
            bg_err_stopped: t('bg_err_stopped'),
            bg_status_deleting_progress: t('bg_status_deleting_progress'),
            bg_err_verify_channel_id: t('bg_err_verify_channel_id'),
            bg_err_verify_channel: t('bg_err_verify_channel'),
            bg_err_mode_server_in_dm: t('bg_err_mode_server_in_dm'),
            bg_err_mode_dm_in_server: t('bg_err_mode_dm_in_server'),
            bg_err_validate_not_found: t('bg_err_validate_not_found'),
            bg_err_validate_generic: t('bg_err_validate_generic')
        }
    };

    const isRangeMode = settings.fromId || settings.untilId;

    if (isRangeMode && !settings.channelId) {
        log(t('err_range_channel'));
        return;
    }

    if (!isRangeMode && !chkAll.checked && !chkAllServer.checked && (isNaN(settings.count) || settings.count <= 0)) {
        log(t('err_valid_number'));
        return;
    }

    const msg = chkAllServer.checked
        ? t('msg_confirm_server')
        : chkAll.checked
        ? t('msg_confirm_all')
        : isRangeMode
        ? t('msg_confirm_range')
        : t('msg_confirm_count', { count: settings.count });

    if (confirm(msg)) {
        toggleControls(true);
        setStatus(t('status_init'));
        await sendMsg({ type: 'start-delete', settings });
    }
});

btnStop.addEventListener('click', () => {
    if (running) {
        chrome.runtime.sendMessage({ type: 'stop-delete' });
        btnStop.textContent = t('btn_stopping');
        btnStop.disabled = true;
    }
});

function setStatus(text, pct = 0) {
    txtStatus.textContent = text;
    barProgress.style.width = `${pct}%`;
}

function log(msg) {
    const time = new Date().toLocaleTimeString();
    txtError.textContent += `[${time}] ${msg}\n`;
    setStatus(t('status_error'), 0);
    toggleControls(false);
}

function toggleControls(disabled) {
    running = disabled;
    btnStart.disabled = disabled;
    btnStop.disabled = !disabled;
    if (!disabled) btnStop.textContent = t('btn_stop');

    [elChannel, elGuild, btnServer, btnDm, sliderDelay, inpCount, chkAll, chkAllServer, elFrom, elUntil, btnOrderAsc, btnOrderDesc]
    .forEach(el => {
        if (el) el.disabled = disabled;
    });

    if (!disabled) {
        updateFormState();
    }
}

async function sendMsg(msg) {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTab = tabs[0];
    if (!activeTab || !activeTab.id) {
        log(t('err_no_tab'));
        return;
    }

    if (!activeTab.url || !activeTab.url.includes("discord.com")) {
        log(t('err_no_discord'));
        return;
    }
    
    try {
        const res = await chrome.runtime.sendMessage(msg);
        if (res && res.status === 'error') {
            log(res.message);
        }
    } catch (e) {
        if (e.message.includes("Receiving end does not exist")) console.warn("Popup cerrado antes de recibir respuesta.");
        else log(`Error: ${e.message}`);
    }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'update-status') {
        setStatus(msg.text, msg.percentage);
        if (msg.done) {
            toggleControls(false);
        }
    }
    if (msg.type === 'deletion-error') {
        log(msg.text);
    }
    return true;
});

(async () => {
    try {
        const res = await chrome.runtime.sendMessage({ type: 'get-status' });
        if (res && res.running) {
            toggleControls(true);
            setStatus(res.status.text, res.status.percentage);
        }
    } catch (e) {
        console.warn("No se pudo obtener el estado del background al iniciar:", e.message);
    }
})();
