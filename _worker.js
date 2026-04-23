export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const auth = request.headers.get('Authorization');

    // 1. 公开分享链接逻辑 (无需密码访问)
    // 链接格式: /share?file=文件名&token=根据ADMIN_PASS生成的简易校验
    if (url.pathname === '/share') {
      const fileName = url.searchParams.get('file');
      const token = url.searchParams.get('token');
      if (token !== btoa(env.ADMIN_PASS).substring(0, 8)) {
        return new Response('分享链接已失效', { status: 403 });
      }
      const object = await env.BUCKET.get(fileName);
      if (!object) return new Response('文件不存在', { status: 404 });
      
      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set('etag', object.httpEtag);
      return new Response(object.body, { headers });
    }

    // 2. API 路由 (需要密码)
    if (url.pathname.startsWith('/api/')) {
      if (auth !== env.ADMIN_PASS) return new Response('Unauthorized', { status: 401 });

      if (url.pathname === '/api/list') {
        const list = await env.BUCKET.list();
        // 返回时带上分享 Token
        const shareToken = btoa(env.ADMIN_PASS).substring(0, 8);
        const files = list.objects.map(o => ({
          key: o.key,
          size: (o.size / 1024 / 1024).toFixed(2) + ' MB',
          date: o.uploaded.toISOString().split('T')[0],
          shareUrl: `${url.origin}/share?file=${encodeURIComponent(o.key)}&token=${shareToken}`
        }));
        return new Response(JSON.stringify(files));
      }

      if (url.pathname === '/api/upload' && request.method === 'POST') {
        const formData = await request.formData();
        const file = formData.get('file');
        await env.BUCKET.put(file.name, file);
        return new Response('OK');
      }

      if (url.pathname === '/api/delete') {
        const key = url.searchParams.get('key');
        await env.BUCKET.delete(key);
        return new Response('Deleted');
      }
    }

    // 3. 前端界面 (Google Material 3 风格)
    return new Response(`
<!DOCTYPE html>
<html lang="zh">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Google Drive Style - R2</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=Google+Sans:wght@400;500;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
    <style>
        body { font-family: 'Google Sans', sans-serif; background-color: #f8f9fa; color: #3c4043; }
        .google-card { background: white; border-radius: 16px; transition: all 0.2s ease; }
        .google-card:hover { box-shadow: 0 1px 3px 0 rgba(60,64,67,0.3), 0 4px 8px 3px rgba(60,64,67,0.15); }
        .btn-google { background: #1a73e8; transition: transform 0.1s; }
        .btn-google:active { transform: scale(0.95); }
        .sidebar-item { border-radius: 0 24px 24px 0; transition: background 0.2s; }
        .sidebar-item:hover { background: #f1f3f4; }
        .sidebar-active { background: #e8f0fe; color: #1967d2; font-weight: 500; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .animate-list { animation: fadeIn 0.4s ease-out forwards; }
    </style>
</head>
<body class="flex h-screen overflow-hidden">
    <div class="w-64 flex-shrink-0 pt-4 hidden md:block">
        <div class="px-6 mb-8 flex items-center space-x-2 text-2xl">
            <i class="fab fa-google-drive text-blue-500"></i>
            <span class="text-gray-600">MyDrive</span>
        </div>
        <div class="sidebar-item sidebar-active py-3 px-6 cursor-pointer mb-1">
            <i class="fas fa-folder mr-4"></i>我的云端硬盘
        </div>
        <div class="sidebar-item py-3 px-6 cursor-pointer text-gray-500 hover:text-gray-700">
            <i class="fas fa-share-alt mr-4"></i>分享给我
        </div>
    </div>

    <div class="flex-grow flex flex-col bg-white md:rounded-tl-[24px] shadow-sm border-l border-gray-200">
        <div class="h-16 flex items-center justify-between px-8 border-b border-gray-100">
            <div id="login-form" class="flex items-center space-x-3 w-full max-w-md">
                <input type="password" id="passInput" placeholder="输入访问代码..." class="w-full bg-gray-100 px-4 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 transition">
                <button onclick="refresh()" class="btn-google text-white px-6 py-2 rounded-lg text-sm font-medium">进入</button>
            </div>
            <div class="flex items-center space-x-4">
                <button onclick="document.getElementById('fIn').click()" class="bg-white border border-gray-300 hover:bg-gray-50 px-4 py-2 rounded-full text-sm font-medium flex items-center shadow-sm transition">
                    <span class="text-xl mr-2 text-blue-600">+</span> 新建
                </button>
                <input type="file" id="fIn" class="hidden" onchange="upload()">
            </div>
        </div>

        <div class="p-8 overflow-y-auto">
            <h2 class="text-sm font-medium text-gray-500 mb-6 uppercase tracking-wider">建议</h2>
            <div id="fileContainer" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                <div class="text-gray-400 italic">等待验证身份...</div>
            </div>
        </div>
    </div>

    <script>
        let secret = localStorage.getItem('drive_pass') || '';
        if(secret) { document.getElementById('passInput').value = secret; refresh(); }

        function refresh() {
            secret = document.getElementById('passInput').value;
            localStorage.setItem('drive_pass', secret);
            load();
        }

        async function load() {
            const res = await fetch('/api/list', { headers: {'Authorization': secret }});
            if(!res.ok) { alert('验证失败'); return; }
            const files = await res.json();
            const container = document.getElementById('fileContainer');
            container.innerHTML = files.map((f, i) => \`
                <div class="google-card border border-gray-200 p-4 animate-list" style="animation-delay: \${i * 0.05}s">
                    <div class="flex items-start justify-between mb-4">
                        <i class="fas fa-file-alt text-3xl text-blue-500"></i>
                        <div class="flex space-x-2">
                             <button onclick="copyShare('\${f.shareUrl}')" title="复制分享链接" class="text-gray-400 hover:text-blue-500"><i class="fas fa-link"></i></button>
                             <button onclick="del('\${f.key}')" class="text-gray-400 hover:text-red-500"><i class="fas fa-trash"></i></button>
                        </div>
                    </div>
                    <div class="truncate font-medium text-gray-700" title="\${f.key}">\${f.key}</div>
                    <div class="text-xs text-gray-400 mt-1">\${f.date} · \${f.size}</div>
                </div>
            \`).join('');
        }

        async function upload() {
            const file = document.getElementById('fIn').files[0];
            if(!file) return;
            const fd = new FormData();
            fd.append('file', file);
            await fetch('/api/upload', { method: 'POST', body: fd, headers: {'Authorization': secret }});
            load();
        }

        async function del(key) {
            if(!confirm('确定移动至垃圾桶？')) return;
            await fetch('/api/delete?key=' + encodeURIComponent(key), { headers: {'Authorization': secret }});
            load();
        }

        function copyShare(url) {
            navigator.clipboard.writeText(url);
            alert('分享链接已复制到剪贴板！');
        }
    </script>
</body>
</html>
    `, { headers: { 'Content-Type': 'text/html' } });
  }
};
