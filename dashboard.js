/* assets/dashboard.js
   - Loads member profile and balances from RTDB
   - Subscribes to transaction history and updates UI
   - Download statement -> calls server to generate PDF
*/

(function() {
    // Ensure firebase libs loaded and init available (from assets/app.js)
    async function ensureFirebase() {
        return new Promise((resolve) => {
            if (window.firebase && typeof initFirebase === 'function') { initFirebase();
                resolve(); } else {
                const s1 = document.createElement('script');
                s1.src = "https://www.gstatic.com/firebasejs/9.24.0/firebase-app-compat.js";
                s1.onload = () => { const s2 = document.createElement('script');
                    s2.src = "https://www.gstatic.com/firebasejs/9.24.0/firebase-auth-compat.js";
                    s2.onload = () => { const s3 = document.createElement('script');
                        s3.src = "https://www.gstatic.com/firebasejs/9.24.0/firebase-database-compat.js";
                        s3.onload = () => { initFirebase();
                            resolve(); };
                        document.head.appendChild(s3); };
                    document.head.appendChild(s2); };
                document.head.appendChild(s1);
            }
        });
    }

    async function start() {
        await ensureFirebase();
        const raw = localStorage.getItem('vyg_user');
        if (!raw) { console.warn('No signed in user'); return; }
        const user = JSON.parse(raw);
        const uid = user.uid;

        // member profile
        const memSnap = await rtdb.ref('members/' + uid).once('value');
        const mem = memSnap.val();
        if (mem) {
            const elName = document.getElementById('memberName');
            if (elName) elName.textContent = mem.name || mem.email || '';
            const elNo = document.getElementById('memberNo');
            if (elNo) elNo.textContent = mem.memberNo || '';
        }

        // load cards (balances). Expect structure: balances/{uid}/{period} etc.
        const cards = [
            { id: 'weekly', title: 'Weekly', path: `balances/${uid}/weekly` },
            { id: 'monthly', title: 'Monthly', path: `balances/${uid}/monthly` },
            { id: 'outstanding', title: 'Outstanding', path: `balances/${uid}/outstanding` },
            { id: 'unpaid', title: 'Unpaid', path: `balances/${uid}/unpaid` },
            { id: 'shares', title: 'Shares', path: `balances/${uid}/shares` },
            { id: 'dividends', title: 'Dividends', path: `balances/${uid}/dividends` },
        ];

        // render cards container if present
        const cardsContainer = document.getElementById('balanceCards');
        if (cardsContainer) {
            cardsContainer.innerHTML = '';
            for (const c of cards) {
                const node = document.createElement('div');
                node.className = 'card card-small';
                node.id = `card-${c.id}`;
                node.innerHTML = `<h4>${c.title}</h4><div class="big" id="value-${c.id}">Loading...</div>`;
                cardsContainer.appendChild(node);
                // listen for value
                rtdb.ref(c.path).on('value', snap => {
                    const v = snap.val();
                    const el = document.getElementById('value-' + c.id);
                    if (el) el.textContent = v === null ? '-' : (typeof v === 'number' ? v.toLocaleString() : v);
                });
            }
        }

        // transaction history subscription: expects transactions/{uid}
        const txTable = document.getElementById('transactionTable');
        if (txTable) {
            rtdb.ref(`transactions/${uid}`).on('value', snap => {
                const rows = snap.val() || {};
                txTable.innerHTML = '';
                Object.keys(rows).sort((a, b) => rows[b].date - rows[a].date).forEach(key => {
                    const r = rows[key];
                    const tr = document.createElement('tr');
                    tr.innerHTML = `<td>${new Date(r.date).toLocaleDateString()}</td>
                          <td>${r.description || ''}</td>
                          <td class="text-right">${r.debit ? r.debit.toLocaleString() : ''}</td>
                          <td class="text-right">${r.credit ? r.credit.toLocaleString() : ''}</td>
                          <td class="text-right">${r.balance ? r.balance.toLocaleString() : ''}</td>`;
                    txTable.appendChild(tr);
                });
            });
        }

        // Download statement button
        const downloadBtn = document.getElementById('downloadStatementBtn');
        if (downloadBtn) {
            downloadBtn.addEventListener('click', async() => {
                downloadBtn.disabled = true;
                downloadBtn.textContent = 'Generating...';
                try {
                    const server = window.SERVER_BASE || (typeof SERVER_BASE !== 'undefined' ? SERVER_BASE : '');
                    if (!server) { alert('Server base URL not configured. Update SERVER_BASE in assets/app.js');
                        downloadBtn.disabled = false;
                        downloadBtn.textContent = 'Download statement'; return; }
                    const res = await fetch(`${server}/generate-statement`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ uid })
                    });
                    const j = await res.json();
                    if (!res.ok) throw new Error(j.message || 'Statement generation failed');
                    // open pdf in new tab (server returns url)
                    window.open(j.url, '_blank');
                } catch (err) {
                    alert('Error: ' + (err.message || err));
                } finally { downloadBtn.disabled = false;
                    downloadBtn.textContent = 'Download statement'; }
            });
        }

        // Repay button per loan (example)
        const repayButtons = document.querySelectorAll('[data-repay-loan]');
        repayButtons.forEach(b => b.addEventListener('click', (ev) => {
            const amount = b.getAttribute('data-amount');
            const ref = b.getAttribute('data-ref');
            redirectToMpesa(amount, ref || mem.memberNo || 'VYG', mem.phone || '2547XXXXXXXX');
        }));
    }

    document.addEventListener('DOMContentLoaded', start);
})();