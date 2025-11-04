/* assets/admin.js
   - Verifies admin role via RTDB (admins/{uid} === true)
   - Lists loanApplications and allows approve/reject/update stage
   - Upload notice (file) via server /upload then create notice entry in RTDB
*/

(async function() {
    // ensure firebase
    function ensureFirebase() {
        return new Promise(resolve => {
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

    await ensureFirebase();

    const raw = localStorage.getItem('vyg_user');
    if (!raw) { alert('Please sign in as admin');
        location.href = 'index.html'; return; }
    const user = JSON.parse(raw);

    // check admin flag in RTDB
    const adminSnap = await rtdb.ref('admins/' + user.uid).once('value');
    if (!adminSnap.val()) { alert('Access denied. Not an admin.');
        location.href = 'index.html'; return; }

    // display admin name
    const memSnap = await rtdb.ref('members/' + user.uid).once('value');
    const mem = memSnap.val() || {};
    document.getElementById('adminName').textContent = mem.name || mem.email || 'Admin';

    // logout
    document.getElementById('logoutBtn').addEventListener('click', async() => { await auth.signOut();
        localStorage.removeItem('vyg_user');
        location.href = 'index.html'; });

    // load loan applications
    const loansTableBody = document.querySelector('#adminLoansTable tbody');

    function renderLoanRow(key, data) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${key}</td>
                    <td>${data.memberUid || ''}</td>
                    <td>${data.loanType || ''}</td>
                    <td>${data.loanAmount || ''}</td>
                    <td>${new Date(data.createdAt).toLocaleString()}</td>
                    <td id="status-${key}">${data.status || ''}</td>
                    <td>
                      <button data-approve="${key}" class="btn">Approve</button>
                      <button data-reject="${key}" class="btn ghost">Reject</button>
                      <button data-stage="${key}" class="btn">Next stage</button>
                    </td>`;
        loansTableBody.appendChild(tr);
    }

    rtdb.ref('loanApplications').on('value', snap => {
        loansTableBody.innerHTML = '';
        const data = snap.val() || {};
        Object.keys(data).sort((a, b) => (data[b].createdAt || 0) - (data[a].createdAt || 0)).forEach(k => renderLoanRow(k, data[k]));
        attachLoanButtons();
    });

    function attachLoanButtons() {
        document.querySelectorAll('button[data-approve]').forEach(b => {
            b.onclick = async() => {
                const id = b.getAttribute('data-approve');
                await rtdb.ref('loanApplications/' + id + '/status').set('Approved');
                // create loan entry in loans/ (admin can edit terms)
                const app = (await rtdb.ref('loanApplications/' + id).once('value')).val();
                const loanNo = 'LN-' + Date.now().toString().slice(-6);
                await rtdb.ref('loans/' + loanNo).set({
                    serial: loanNo,
                    applicationId: id,
                    memberUid: app.memberUid,
                    product: app.loanType,
                    amount: app.loanAmount,
                    status: 'Approved',
                    createdAt: Date.now()
                });
                alert('Approved and loan record created: ' + loanNo);
            };
        });

        document.querySelectorAll('button[data-reject]').forEach(b => {
            b.onclick = async() => {
                const id = b.getAttribute('data-reject');
                await rtdb.ref('loanApplications/' + id + '/status').set('Rejected');
                alert('Application rejected');
            };
        });

        document.querySelectorAll('button[data-stage]').forEach(b => {
            b.onclick = async() => {
                const id = b.getAttribute('data-stage');
                const snap = await rtdb.ref('loanApplications/' + id + '/status').once('value');
                const status = snap.val() || 'Submitted';
                let next = 'Under Review';
                if (status === 'Submitted') next = 'Under Review';
                else if (status === 'Under Review') next = 'Approved For Disbursement';
                else if (status === 'Approved For Disbursement') next = 'Disbursed';
                else next = 'Completed';
                await rtdb.ref('loanApplications/' + id + '/status').set(next);
                document.getElementById('status-' + id).textContent = next;
                alert('Moved to: ' + next);
            };
        });
    }

    // notice upload
    document.getElementById('noticeForm').addEventListener('submit', async function(e) {
        e.preventDefault();
        const title = document.getElementById('noticeTitle').value;
        const desc = document.getElementById('noticeDescription').value;
        const file = document.getElementById('noticeFile').files[0];
        const messageEl = document.getElementById('noticeMessage');
        messageEl.textContent = 'Uploading...';
        try {
            let fileUrl = '';
            if (file) {
                const server = window.SERVER_BASE || (typeof SERVER_BASE !== 'undefined' ? SERVER_BASE : '');
                if (!server) throw new Error('Server not configured');
                const fd = new FormData();
                fd.append('file', file);
                const r = await fetch(`${server}/upload`, { method: 'POST', body: fd });
                const j = await r.json();
                if (!r.ok) throw new Error(j.message || 'Upload failed');
                fileUrl = j.url;
            }
            const noticeRef = rtdb.ref('notices').push();
            await noticeRef.set({ title, description: desc, fileUrl, createdAt: Date.now(), createdBy: user.uid });
            messageEl.textContent = 'Notice published.';
        } catch (err) {
            messageEl.textContent = 'Error: ' + (err.message || err);
        }
    });

})();