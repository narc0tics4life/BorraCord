let running = false;
let job = { deleted: 0, failed: 0, total: 0 };
let i18n = {};
let lastStatus = { text: '', percentage: 0, done: false };

function getAuth() {
    try {
        let token, userId;
        try {
            const iframe = document.createElement('iframe');
            iframe.style.display = 'none';
            document.body.appendChild(iframe);
            const ls = iframe.contentWindow.localStorage;
            token = JSON.parse(ls.getItem('token'));
            userId = JSON.parse(ls.getItem('user_id_cache'));
            iframe.remove();
        } catch (e) {
            console.warn("Credential retrieval method (iframe) failed, attempting fallback:", e.message);
        }

        if (token && userId) {
            return { token, userId };
        }

        const webpackChunkName = Object.keys(window).find(key => key.startsWith('webpackChunk') && Array.isArray(window[key]));
        if (!webpackChunkName) {
            throw new Error("Discord 'webpack chunk' not found in window object. Script might be outdated.");
        }
        const webpackChunk = window[webpackChunkName];

        let modules = [];
        webpackChunk.push([['borracord_inj'], {}, (e) => { for (let c in e.c) modules.push(e.c[c]); }]);
        
        const tokenFinder = modules.find(m => m?.exports?.default?.getToken);
        if (!tokenFinder) throw new Error("Function 'getToken' not found in webpack modules.");
        const foundToken = tokenFinder.exports.default.getToken();

        const userFinder = modules.find(m => m?.exports?.default?.getCurrentUser);
        if (!userFinder) throw new Error("Function 'getCurrentUser' not found in webpack modules.");
        const foundUserId = userFinder.exports.default.getCurrentUser().id;

        if (!foundToken || !foundUserId) throw new Error("Could not get token or userId from webpack. Make sure you are logged in.");
        
        return { token: foundToken, userId: foundUserId };

    } catch (e) {
        return { error: `Both methods failed. Error: ${e.message}. Make sure you are on a Discord page and logged in.` };
    }
}

function getUrlInfo() {
    try {
        const pathParts = window.location.pathname.split('/');
        return {
            guildId: pathParts[2],
            channelId: pathParts[3]
        };
    } catch(e) {
        return { error: e.message };
    }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function updateStatus(text, percentage = 0, done = false) {
    lastStatus = { text, percentage, done };
    chrome.runtime.sendMessage({ type: 'update-status', ...lastStatus }).catch(e => console.log("Error sending status:", e.message));
}

function logErr(msg) {
    chrome.runtime.sendMessage({ type: 'deletion-error', text: msg }).catch(() => {});
}

async function inject(func) {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabId = tabs[0]?.id;
    if (!tabId) throw new Error("No active Discord tab found.");

    const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        func: func,
    });
    
    if (result.result?.error) {
        throw new Error(result.result.error);
    }
    return result.result;
}

async function validateMessageId(authToken, channelId, messageId) {
    const resp = await fetch(`https://discord.com/api/v9/channels/${channelId}/messages/${messageId}`, {
        headers: { 'Authorization': authToken }
    });
    if (!resp.ok) {
        if (resp.status === 404) {
            throw new Error(i18n.bg_err_validate_not_found.replace('{messageId}', messageId));
        }
        throw new Error(i18n.bg_err_validate_generic.replace('{messageId}', messageId).replace('{status}', resp.status));
    }
}

async function verifyChannelAndMode(authToken, channelId, mode) {
    const resp = await fetch(`https://discord.com/api/v9/channels/${channelId}`, {
        headers: { 'Authorization': authToken }
    });
    
    if (!resp.ok) {
        if (resp.status === 404 || resp.status === 403) {
             throw new Error(i18n.bg_err_verify_channel_id.replace('{status}', resp.status));
        }
        throw new Error(i18n.bg_err_verify_channel.replace('{status}', resp.status));
    }

    const channel = await resp.json();
    const isDm = channel.type === 1 || channel.type === 3;
    
    if (mode === 'server' && isDm) throw new Error(i18n.bg_err_mode_server_in_dm);
    if (mode === 'dm' && !isDm) throw new Error(i18n.bg_err_mode_dm_in_server);
}


async function run({ delay, count, channelId: manualChannelId, guildId: manualGuildId, mode, deleteAllServer, fromId, untilId, order, i18n: i18n_payload }) {
    if (running) {
        logErr(i18n.bg_err_running);
        return;
    }

    i18n = i18n_payload;
    running = true;
    job = { deleted: 0, failed: 0, total: count };
    updateStatus(i18n.bg_status_creds);

    try {
        const creds = await inject(getAuth);
        const context = await inject(getUrlInfo);

        const authToken = creds.token;
        const userId = creds.userId;
        const channelId = manualChannelId || context.channelId;

        if (deleteAllServer) {
            if (mode === 'dm') throw new Error(i18n.bg_err_server_mode_dm);

            const targetGuildId = manualGuildId || context.guildId;
            if (!targetGuildId || targetGuildId === '@me') {
                throw new Error(i18n.bg_err_no_guild);
            }
            updateStatus(i18n.bg_status_get_channels);
            const channels = await getChannels(authToken, targetGuildId);
            const textChannels = channels.filter(c => c.type === 0 || c.type === 5);
            
            updateStatus(i18n.bg_status_found_channels.replace('{count}', textChannels.length));
            
            let totalDeleted = 0;
            for (const channel of textChannels) {
                if (!running) break;
                job.deleted = 0;
                job.failed = 0;
                job.total = 0;
                
                await processChannel(authToken, userId, channel.id, -1, delay, channel.name, { order });
                totalDeleted += job.deleted;
            }
            updateStatus(i18n.bg_status_server_done.replace('{count}', totalDeleted), 100, true);
            
        } else {
            if (!channelId) {
                throw new Error(i18n.bg_err_no_channel);
            }
            
            
            await verifyChannelAndMode(authToken, channelId, mode);

        
            if (fromId) {
                try { await validateMessageId(authToken, channelId, fromId); } catch (e) { console.warn("Ignorando error de validación fromId:", e); }
            }
            if (untilId) {
                try { await validateMessageId(authToken, channelId, untilId); } catch (e) { console.warn("Ignorando error de validación untilId:", e); }
            }

            await processChannel(authToken, userId, channelId, count, delay, null, { fromId, untilId, order });
            updateStatus(i18n.bg_status_done.replace('{count}', job.deleted), 100, true);
        }

    } catch (error) {
        console.error("Error en el proceso de borrado:", error);
        logErr(error.message || i18n.bg_err_unknown);
    } finally {
        running = false;
    }
}

async function processChannel(authToken, userId, channelId, count, delay, channelName, range = {}) {
    updateStatus(channelName ? i18n.bg_status_searching_in.replace('{channel}', channelName) : i18n.bg_status_searching);
    
    let messages;
    if (range.fromId || range.untilId) {
        messages = await getMsgsByRange(authToken, userId, channelId, range.fromId, range.untilId);
    } else {
        messages = await getMsgsByCount(authToken, userId, channelId, count);
    }

    let effectiveOrder = range.order;
    
    if (range.fromId && range.untilId) {
        effectiveOrder = BigInt(range.fromId) < BigInt(range.untilId) ? 'asc' : 'desc';
    }

    if (effectiveOrder === 'asc') {
        messages.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
    } else { 
        messages.sort((a, b) => (BigInt(a.id) > BigInt(b.id) ? -1 : 1));
    }

    job.total = messages.length;

    if (messages.length === 0) {
        if (!channelName) updateStatus(i18n.bg_status_no_msgs, 100, true);
        return;
    }

    const deletingMsg = channelName 
        ? i18n.bg_status_deleting_in.replace('{count}', messages.length).replace('{channel}', channelName)
        : i18n.bg_status_deleting.replace('{count}', messages.length);
    updateStatus(deletingMsg);
    await delMsgs(authToken, messages, delay);
}

async function getChannels(authToken, guildId) {
    const resp = await fetch(`https://discord.com/api/v9/guilds/${guildId}/channels`, {
        headers: { 'Authorization': authToken }
    });
    if (!resp.ok) {
        if (resp.status === 403) throw new Error(i18n.bg_err_no_perms_channels);
        throw new Error(i18n.bg_err_get_channels.replace('{status}', resp.status));
    }
    return await resp.json();
}

async function getMsgsByCount(authToken, userId, channelId, limit) {
    const allMessages = [];
    let beforeId = null;
    const batchSize = 100;

    while (running && (limit === -1 || allMessages.length < limit)) {
        updateStatus(i18n.bg_status_fetching.replace('{count}', allMessages.length));
        
        const url = new URL(`https://discord.com/api/v9/channels/${channelId}/messages`);
        url.searchParams.set('limit', batchSize);
        if (beforeId) {
            url.searchParams.set('before', beforeId);
        }
        
        const resp = await fetch(url.toString(), { headers: { 'Authorization': authToken } });

        if (!resp.ok) {
            if (resp.status === 429) {
                const retryAfter = (await resp.json()).retry_after * 1000;
                updateStatus(i18n.bg_status_ratelimit.replace('{seconds}', Math.round(retryAfter / 1000)));
                await sleep(retryAfter);
                continue;
            }
            throw new Error(i18n.bg_err_get_msgs.replace('{status}', resp.status));
        }

        const messages = await resp.json();
        if (!messages || messages.length === 0) break;

        beforeId = messages[messages.length - 1].id;

        const userMessages = messages.filter(msg => msg.author.id === userId);

        for (const msg of userMessages) {
            if (limit !== -1 && allMessages.length >= limit) break;
            allMessages.push(msg);
        }
        
        await sleep(200);
    }
    return allMessages;
}

async function getMsgsByRange(authToken, userId, channelId, fromId, untilId) {
    const allMessages = [];
    
    const fromBig = fromId ? BigInt(fromId) : null;
    const untilBig = untilId ? BigInt(untilId) : null;

    let startPoint = null;
    let endPoint = null;

    if (fromBig && untilBig) {
        startPoint = fromBig > untilBig ? fromId : untilId;
        endPoint = fromBig < untilBig ? fromBig : untilBig;
    } else if (fromId) {
        startPoint = null;
        endPoint = fromBig;
    } else if (untilId) {
        startPoint = null;
        endPoint = untilBig;
    }

    let beforeId = startPoint;

    while (running) {
        updateStatus(i18n.bg_status_fetching_range.replace('{count}', allMessages.length));
        
        const url = new URL(`https://discord.com/api/v9/channels/${channelId}/messages`);
        url.searchParams.set('limit', 100);
        if (beforeId) {
            url.searchParams.set('before', beforeId);
        }
        
        const resp = await fetch(url.toString(), { headers: { 'Authorization': authToken } });

        if (!resp.ok) {
            if (resp.status === 429) {
                const retryAfter = (await resp.json()).retry_after * 1000;
                updateStatus(i18n.bg_status_ratelimit.replace('{seconds}', Math.round(retryAfter / 1000)));
                await sleep(retryAfter);
                continue;
            }
            throw new Error(i18n.bg_err_get_msgs.replace('{status}', resp.status));
        }

        const messages = await resp.json();
        if (!messages || messages.length === 0) break;

        beforeId = messages[messages.length - 1].id;
        
        let stopLoop = false;
        for (const msg of messages) {
            const msgBig = BigInt(msg.id);
            
            if (endPoint && msgBig < endPoint) {
                stopLoop = true;
                break;
            }

            if (msg.author.id === userId) {
                allMessages.push(msg);
            }
        }

        if (stopLoop) break;
        await sleep(200);
    }
    return allMessages;
}

async function delMsgs(authToken, messages, delay) {
    for (let i = 0; i < messages.length; i++) {
        if (!running) {
            logErr(i18n.bg_err_stopped);
            break;
        }

        const message = messages[i];
        const deleteUrl = `https://discord.com/api/v9/channels/${message.channel_id}/messages/${message.id}`;
        
        const resp = await fetch(deleteUrl, { method: 'DELETE', headers: { 'Authorization': authToken } });

        if (resp.ok) {
            job.deleted++;
        } else {
            if (resp.status === 429) {
                const retryAfter = (await resp.json()).retry_after * 1000;
                updateStatus(i18n.bg_status_ratelimit.replace('{seconds}', Math.round(retryAfter / 1000)));
                await sleep(retryAfter);
                i--;
            } else {
                job.failed++;
                console.warn(`Could not delete message ${message.id}, status: ${resp.status}`);
            }
        }
        
        const percentage = (job.deleted + job.failed) / job.total * 100;
        updateStatus(i18n.bg_status_deleting_progress.replace('{deleted}', job.deleted).replace('{total}', job.total), percentage);
        await sleep(delay);
    }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'start-delete') {
        run(message.settings).then(() => sendResponse({ status: "completed" })).catch(error => {
            logErr(error.message);
            sendResponse({ status: "error", message: error.message });
        });
        return true;
    }
    if (message.type === 'stop-delete') {
        running = false;
        sendResponse({ status: "stopped" });
    }
    if (message.type === 'get-status') {
        sendResponse({ 
            running: running,
            status: lastStatus
        });
        return true; 
    }
    return false;
});