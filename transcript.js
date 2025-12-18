chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'init-transcript') {
        document.getElementById('t-title').textContent = msg.data.title;
        document.getElementById('t-info').textContent = msg.data.info;
        document.getElementById('l-date').textContent = msg.data.dateLabel;
        document.getElementById('v-date').textContent = msg.data.dateValue;
        document.getElementById('l-time').textContent = msg.data.timeLabel;
        document.getElementById('v-time').textContent = msg.data.timeValue;
        document.getElementById('l-context').textContent = msg.data.contextLabel;
        document.getElementById('v-context').textContent = msg.data.contextValue;
    }
    if (msg.type === 'transcript-log') {
        const container = document.getElementById('transcript-container');
        if (container) {
            const entry = document.createElement('div');
            entry.className = 'entry';
            entry.textContent = msg.line;
            container.appendChild(entry);
            window.scrollTo(0, document.body.scrollHeight);
        }
    }
});