let running = false;
let job = { deleted: 0, failed: 0, total: 0 };
let i18n = {};
let lastStatus = { text: '', percentage: 0, done: false };
let transcriptTabId = null;

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
        world: 'MAIN',
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
    if (!channel) throw new Error("Could not get channel information.");
    const isDm = channel.type === 1 || channel.type === 3;
    
    if (mode === 'server' && isDm) throw new Error(i18n.bg_err_mode_server_in_dm);
    if (mode === 'dm' && !isDm) throw new Error(i18n.bg_err_mode_dm_in_server);
    return channel;
}


async function run({ delay, count, channelId: manualChannelId, guildId: manualGuildId, mode, deleteAllServer, fromId, untilId, order, transcript, i18n: i18n_payload }) {
    if (running) {
        logErr(i18n.bg_err_running);
        return;
    }

    i18n = i18n_payload;
    running = true;
    job = { deleted: 0, failed: 0, total: count };
    transcriptTabId = null;
    updateStatus(i18n.bg_status_creds);

    try {
        const creds = await inject(getAuth);
        const context = await inject(getUrlInfo);

        const authToken = creds.token;
        const userId = creds.userId;
        const channelId = manualChannelId || context.channelId;

        let targetName = "";
        let isDmType = false;
        let channel = null;

        if (deleteAllServer) {
            if (mode === 'dm') throw new Error(i18n.bg_err_server_mode_dm);
            const targetGuildId = manualGuildId;
            if (!targetGuildId || targetGuildId === '@me') throw new Error(i18n.bg_err_no_guild);
            
            const gResp = await fetch(`https://discord.com/api/v9/guilds/${targetGuildId}`, { headers: { 'Authorization': authToken } }).catch(() => null);
            if (gResp && gResp.ok) {
                const gData = await gResp.json();
                targetName = gData.name;
            } else {
                targetName = `Server ID: ${targetGuildId}`;
            }
            isDmType = false;
        } else {
            if (!channelId) throw new Error(i18n.bg_err_no_channel);
            channel = await verifyChannelAndMode(authToken, channelId, mode);
            targetName = channel.name || (channel.recipients ? channel.recipients.map(r => r.username).join(", ") : "Unknown");
            isDmType = channel.type === 1 || channel.type === 3;
        }

        if (transcript) {
            try {
                const tab = await chrome.tabs.create({ 
                    url: chrome.runtime.getURL('transcript.html'),
                    active: false 
            });
                transcriptTabId = tab.id;
                
                if (tab.status !== 'complete') {
                    await new Promise(resolve => {
                        const listener = (tid, changeInfo) => {
                            if (tid === transcriptTabId && changeInfo.status === 'complete') {
                                chrome.tabs.onUpdated.removeListener(listener);
                                resolve();
                            }
                        };
                        chrome.tabs.onUpdated.addListener(listener);
                        setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve(); }, 3000);
                    });
                }
                await sleep(100);
                const now = new Date();
                chrome.tabs.sendMessage(transcriptTabId, {
                    type: 'init-transcript',
                    data: {
                        title: i18n.transcript_title,
                        info: i18n.transcript_info,
                        dateLabel: i18n.transcript_date,
                        timeLabel: i18n.transcript_time,
                        contextLabel: isDmType ? i18n.transcript_dm : i18n.transcript_server,
                        dateValue: now.toLocaleDateString(),
                        timeValue: now.toLocaleTimeString(),
                        contextValue: targetName
                    }
                }).catch(() => { console.warn("Could not initialize transcript header (tab closed or slow)."); });
            } catch (e) { console.error("Error creating transcript tab:", e); }
        }

        if (deleteAllServer) {
            const targetGuildId = manualGuildId;
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
                
                try {
                    await processChannel(authToken, userId, channel.id, -1, delay, channel.name, { order, guildId: targetGuildId });
                    totalDeleted += job.deleted;
                } catch (e) {
                    console.error(`Failed to process channel ${channel.name} (${channel.id}):`, e);
                    logErr(`Skipping channel "${channel.name}": ${e.message}`);
                    await sleep(1000);
                }
            }
            updateStatus(i18n.bg_status_server_done.replace('{count}', totalDeleted), 100, true);
            
        } else {
            if (fromId) {
                try { await validateMessageId(authToken, channelId, fromId); } catch (e) { console.warn("Ignoring fromId validation error:", e); }
            }
            if (untilId) {
                try { await validateMessageId(authToken, channelId, untilId); } catch (e) { console.warn("Ignoring untilId validation error:", e); }
            }

            await processChannel(authToken, userId, channelId, count, delay, null, { fromId, untilId, order, guildId: channel.guild_id });
            updateStatus(i18n.bg_status_done.replace('{count}', job.deleted), 100, true);
        }

    } catch (error) {
        console.error("Error in deletion process:", error);
        const isKnownError = Object.values(i18n).includes(error.message);
        if (isKnownError) {
            logErr(error.message);
        } else {
            logErr(`${i18n.bg_err_generic_js || 'Unexpected script error'}: ${error.message || i18n.bg_err_unknown}`);
        }
    } finally {
        running = false;
    }
}

async function processChannel(authToken, userId, channelId, count, delay, channelName, range = {}) {
    updateStatus(channelName ? i18n.bg_status_searching_in.replace('{channel}', channelName) : i18n.bg_status_searching);
    
    let messages;
    if (range.fromId || range.untilId) {
        messages = await getMsgsByRange(authToken, userId, channelId, range.fromId, range.untilId, range.guildId);
    } else {
        messages = await getMsgsByCount(authToken, userId, channelId, count, range.guildId);
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

async function getMsgsByCount(authToken, userId, channelId, limit, guildId) {
    try {
        return await getMsgsByCountFast(authToken, userId, channelId, limit, guildId);
    } catch (e) {
        if (e.message.includes('403')) return [];
        
        if (e.message.includes('400')) {
            console.warn("Search API failed (Fast Mode), switching to Standard API (Safe Mode). Error:", e.message);
            try {
                return await getMsgsByCountSlow(authToken, userId, channelId, limit);
            } catch (e2) {
                if (e2.message.includes('403')) return [];
                throw e2;
            }
        }
        throw e;
    }
}

async function getMsgsByRange(authToken, userId, channelId, fromId, untilId, guildId) {
    try {
        return await getMsgsByRangeFast(authToken, userId, channelId, fromId, untilId, guildId);
    } catch (e) {
        if (e.message.includes('403')) return [];

        if (e.message.includes('400')) {
            console.warn("Search API failed (Fast Mode), switching to Standard API (Safe Mode). Error:", e.message);
            try {
                return await getMsgsByRangeSlow(authToken, userId, channelId, fromId, untilId);
            } catch (e2) {
                if (e2.message.includes('403')) return [];
                throw e2;
            }
        }
        throw e;
    }
}

async function getMsgsByCountFast(authToken, userId, channelId, limit, guildId) {
    const allMessages = [];
    let offset = 0;
    const batchSize = 25;
    let emptyHits = 0;
    const foundIds = new Set();
    let searchDelay = 1000;

    while (running && (limit === -1 || allMessages.length < limit)) {
        const preFetchCount = allMessages.length;
        updateStatus(i18n.bg_status_fetching.replace('{count}', allMessages.length));
        
        let url;
        if (guildId) {
            url = new URL(`https://discord.com/api/v9/guilds/${guildId}/messages/search`);
            url.searchParams.set('channel_id', channelId);
        } else {
            url = new URL(`https://discord.com/api/v9/channels/${channelId}/messages/search`);
        }
        url.searchParams.set('author_id', userId);
        url.searchParams.set('offset', offset);
        url.searchParams.set('sort_by', 'timestamp');
        url.searchParams.set('sort_order', 'desc');

        const resp = await fetch(url.toString(), { headers: { 'Authorization': authToken } });

        if (!resp.ok) {
            if (resp.status === 429) {
                const json = await resp.json();
                let retryAfter = (json.retry_after || 0) * 1000;
                if (retryAfter < 1000) retryAfter = 1000;
                searchDelay += 300;
                updateStatus(i18n.bg_status_ratelimit.replace('{seconds}', Math.ceil(retryAfter / 1000)));
                await sleep(retryAfter);
                continue;
            }
            if (resp.status === 202) {
                const retryAfter = (await resp.json()).retry_after * 1000;
                updateStatus('Discord is indexing... retrying soon.');
                await sleep(retryAfter || 2000);
                continue;
            }
            if (resp.status >= 500 && resp.status < 600) {
                console.warn(`[BorraCord] Discord server error: ${resp.status}. Retrying in 5 seconds...`);
                updateStatus(`Server error (${resp.status}). Retrying...`);
                await sleep(5000);
                continue;
            }
            throw new Error(i18n.bg_err_get_msgs.replace('{status}', resp.status));
        }

        const searchResult = await resp.json();
        const foundMessages = searchResult.messages.flat().filter(m => m.hit === true);

        if (searchResult.messages.length === 0) {
            break;
        }

        for (const msg of foundMessages) {
            if (limit !== -1 && allMessages.length >= limit) break;
            if (!foundIds.has(msg.id)) {
                allMessages.push(msg);
                foundIds.add(msg.id);
            }
        }
        
        if (allMessages.length === preFetchCount) {
            emptyHits++;
            if (emptyHits >= 5) {
                break;
            }
        } else {
            emptyHits = 0;
        }
        
        offset += searchResult.messages.length;
        
        if (offset >= searchResult.total_results) {
            break;
        }

        await sleep(searchDelay);
    }
    return allMessages;
}

async function getMsgsByCountSlow(authToken, userId, channelId, limit) {
    const allMessages = [];
    let beforeId = null;
    const batchSize = 100;
    let dots = 0;
    let totalScanned = 0;

    while (running && (limit === -1 || allMessages.length < limit)) {
        dots = (dots + 1) % 4;
        updateStatus(i18n.bg_status_fetching.replace('{count}', allMessages.length) + ` [Scan: ${totalScanned}]` + ".".repeat(dots));
        
        const url = new URL(`https://discord.com/api/v9/channels/${channelId}/messages`);
        url.searchParams.set('limit', batchSize);
        if (beforeId) url.searchParams.set('before', beforeId);
        
        const resp = await fetch(url.toString(), { headers: { 'Authorization': authToken } });

        if (!resp.ok) {
            if (resp.status === 429) {
                const json = await resp.json();
                let retryAfter = (json.retry_after || 0) * 1000;
                if (retryAfter < 1000) retryAfter = 1000;
                updateStatus(i18n.bg_status_ratelimit.replace('{seconds}', Math.ceil(retryAfter / 1000)));
                await sleep(retryAfter);
                continue;
            }
            if (resp.status >= 500 && resp.status < 600) {
                console.warn(`[BorraCord] Discord server error: ${resp.status}. Retrying in 5 seconds...`);
                updateStatus(`Server error (${resp.status}). Retrying...`);
                await sleep(5000);
                continue;
            }
            throw new Error(i18n.bg_err_get_msgs.replace('{status}', resp.status));
        }

        const messages = await resp.json();
        if (!messages || messages.length === 0) break;
        totalScanned += messages.length;
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

async function getMsgsByRangeFast(authToken, userId, channelId, fromId, untilId, guildId) {
    const allMessages = [];
    let offset = 0;
    let emptyHits = 0;
    const batchSize = 25;
    const foundIds = new Set();
    let searchDelay = 1000;

    while (running) {
        const preFetchCount = allMessages.length;
        updateStatus(i18n.bg_status_fetching_range.replace('{count}', allMessages.length));
        
        let url;
        if (guildId) {
            url = new URL(`https://discord.com/api/v9/guilds/${guildId}/messages/search`);
            url.searchParams.set('channel_id', channelId);
        } else {
            url = new URL(`https://discord.com/api/v9/channels/${channelId}/messages/search`);
        }
        url.searchParams.set('author_id', userId);
        url.searchParams.set('offset', offset);
        url.searchParams.set('sort_by', 'timestamp');
        url.searchParams.set('sort_order', 'desc');

        if (fromId) url.searchParams.set('min_id', fromId);
        if (untilId) url.searchParams.set('max_id', untilId);
        
        const resp = await fetch(url.toString(), { headers: { 'Authorization': authToken } });

        if (!resp.ok) {
            if (resp.status === 429) {
                const json = await resp.json();
                let retryAfter = (json.retry_after || 0) * 1000;
                if (retryAfter < 1000) retryAfter = 1000;
                searchDelay += 300;
                updateStatus(i18n.bg_status_ratelimit.replace('{seconds}', Math.ceil(retryAfter / 1000)));
                await sleep(retryAfter);
                continue;
            }
            if (resp.status === 202) {
                const retryAfter = (await resp.json()).retry_after * 1000;
                updateStatus('Discord is indexing... retrying soon.');
                await sleep(retryAfter || 2000);
                continue;
            }
            if (resp.status >= 500 && resp.status < 600) {
                console.warn(`[BorraCord] Discord server error: ${resp.status}. Retrying in 5 seconds...`);
                updateStatus(`Server error (${resp.status}). Retrying...`);
                await sleep(5000);
                continue;
            }
            throw new Error(i18n.bg_err_get_msgs.replace('{status}', resp.status));
        }

        const searchResult = await resp.json();
        const foundMessages = searchResult.messages.flat().filter(m => m.hit === true);

        if (searchResult.messages.length === 0) {
            break;
        }

        for (const msg of foundMessages) {
            if (!foundIds.has(msg.id)) {
                allMessages.push(msg);
                foundIds.add(msg.id);
            }
        }
        offset += searchResult.messages.length;
        if (offset >= searchResult.total_results) {
            break;
        }
        
        if (allMessages.length === preFetchCount) {
            emptyHits++;
            if (emptyHits >= 5) {
                break;
            }
        } else {
            emptyHits = 0;
        }

        await sleep(searchDelay);
    }
    return allMessages;
}

async function getMsgsByRangeSlow(authToken, userId, channelId, fromId, untilId) {
    const allMessages = [];
    let beforeId = untilId || null;
    const batchSize = 100;
    const endId = fromId ? BigInt(fromId) : 0n;
    let dots = 0;
    let totalScanned = 0;

    while (running) {
        dots = (dots + 1) % 4;
        updateStatus(i18n.bg_status_fetching_range.replace('{count}', allMessages.length) + ` [Scan: ${totalScanned}]` + ".".repeat(dots));
        
        const url = new URL(`https://discord.com/api/v9/channels/${channelId}/messages`);
        url.searchParams.set('limit', batchSize);
        if (beforeId) url.searchParams.set('before', beforeId);
        
        const resp = await fetch(url.toString(), { headers: { 'Authorization': authToken } });

        if (!resp.ok) {
            if (resp.status === 429) {
                const json = await resp.json();
                let retryAfter = (json.retry_after || 0) * 1000;
                if (retryAfter < 1000) retryAfter = 1000;
                updateStatus(i18n.bg_status_ratelimit.replace('{seconds}', Math.ceil(retryAfter / 1000)));
                await sleep(retryAfter);
                continue;
            }
            if (resp.status >= 500 && resp.status < 600) {
                console.warn(`[BorraCord] Discord server error: ${resp.status}. Retrying in 5 seconds...`);
                updateStatus(`Server error (${resp.status}). Retrying...`);
                await sleep(5000);
                continue;
            }
            throw new Error(i18n.bg_err_get_msgs.replace('{status}', resp.status));
        }

        const messages = await resp.json();
        if (!messages || messages.length === 0) break;
        totalScanned += messages.length;
        beforeId = messages[messages.length - 1].id;
        
        for (const msg of messages) {
            const msgId = BigInt(msg.id);
            if (endId > 0n && msgId < endId) return allMessages;
            if (msg.author.id === userId) allMessages.push(msg);
        }
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

        try {
            const message = messages[i];
            const deleteUrl = `https://discord.com/api/v9/channels/${message.channel_id}/messages/${message.id}`;
            
            const resp = await fetch(deleteUrl, { method: 'DELETE', headers: { 'Authorization': authToken } });

            if (resp.ok) {
                job.deleted++;
                if (transcriptTabId) {
                    const date = new Date(message.timestamp);
                    const timeStr = date.getHours().toString().padStart(2, '0') + ":" + date.getMinutes().toString().padStart(2, '0');
                    const dateStr = date.getDate().toString().padStart(2, '0') + "/" + (date.getMonth() + 1).toString().padStart(2, '0') + "/" + date.getFullYear();
                    
                    let content = message.content || "";
                    if (message.attachments && message.attachments.length > 0) {
                        const attachmentLogs = message.attachments.map(a => {
                            const isImg = a.content_type?.startsWith('image/');
                            const isVid = a.content_type?.startsWith('video/');
                            const label = isImg ? 'Image' : (isVid ? 'Video' : 'File');
                            return `[${label}: ${a.filename}]`;
                        }).join(' ');
                        content += (content ? " " : "") + attachmentLogs;
                    }
                    const finalContent = content.trim() || "[Empty message]";
                    const logLine = `${timeStr} [${dateStr}] ${message.author.username}: ${finalContent}`;

                    chrome.tabs.sendMessage(transcriptTabId, { type: 'transcript-log', line: logLine }).catch(() => {
                        transcriptTabId = null;
                    });
                }
            } else {
                if (resp.status === 429) {
                    const json = await resp.json();
                    let retryAfter = (json.retry_after || 0) * 1000;
                    if (retryAfter < 1000) retryAfter = 1000;
                    updateStatus(i18n.bg_status_ratelimit.replace('{seconds}', Math.ceil(retryAfter / 1000)));
                    await sleep(retryAfter);
                    i--;
                } else {
                    job.failed++;
                    console.warn(`Could not delete message ${message.id}, status: ${resp.status}`);
                }
            }
        } catch (e) {
            console.error("Error deleting message:", e);
            job.failed++;
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