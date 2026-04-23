import { Hono } from 'hono'
import { html } from 'hono/html'

const app = new Hono<{ Bindings: { BUCKET: R2Bucket, ADMIN_PASS: string } }>()

// 前端页面逻辑
app.get('/', (c) => {
  return c.html(
    html`<!DOCTYPE html>
    <html lang="zh">
    <head>
        <meta charset="UTF-8">
        <title>R2 Storage</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
    </head>
    <body class="bg-[#0f172a] text-slate-200 min-h-screen flex items-center justify-center font-sans">
        <div id="app" class="w-full max-w-3xl p-6">
            <div class="bg-white/10 backdrop-blur-xl border border-white/20 rounded-3xl p-8 shadow-2xl">
                <div class="flex justify-between items-center mb-10">
                    <h1 class="text-3xl font-extrabold bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">
                        MyDrive Pro
                    </h1>
                    <div id="status" class="text-xs text-slate-400 font-mono">Ready</div>
                </div>

                <div id="login-box" class="space-y-4">
                    <input type="password" id="pass" placeholder="输入访问令牌..." 
                        class="w-full bg-white/5 border border-white/10 rounded-2xl p-4 outline-none focus:border-blue-500 transition">
                    <button onclick="init()" class="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-4 rounded-2xl transition shadow-lg shadow-blue-900/20">
                        进入私有云
                    </button>
                </div>

                <div id="main-content" class="hidden space-y-6">
                    <div class="group relative border-2 border-dashed border-white/10 rounded-2xl p-10 text-center hover:border-blue-500/50 transition bg-white/5">
                        <input type="file" id="fileInput" class="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onchange="upload()">
                        <div class="space-y-2">
                            <i class="fas fa-cloud-upload-alt text-4xl text-blue-400"></i>
                            <p class="text-slate-400">点击或拖拽文件至此上传</p>
                        </div>
                    </div>

                    <div id="file-list" class="space-y-3 max-h-96 overflow-y-auto pr-2 text-sm">
                        </div>
                </div>
            </div>
        </div>

        <script>
            let pass = '';
            const $ = id => document.getElementById(id);

            async function init() {
                pass = $('pass').value;
                const res = await fetch('/api/list', { headers: { 'Authorization': pass } });
                if (res.ok) {
                    $('login-box').style.display = 'none';
                    $('main-content').style.display = 'block';
                    loadFiles();
                } else {
                    alert('密码错误');
                }
            }

            async function loadFiles() {
                const res = await fetch('/api/list', { headers: { 'Authorization': pass } });
                const files = await res.json();
                $('file-list').innerHTML = files.map(f => \`
                    <div class="flex items-center justify-between p-4 bg-white/5 rounded-xl border border-white/5 group hover:bg-white/10 transition">
                        <div class="flex items-center space-x-3">
                            <i class="far fa-file text-blue-400"></i>
                            <span class="truncate max-w-[200px]">\${f.key}</span>
                        </div>
                        <div class="flex space-x-4 opacity-0 group-hover:opacity-100 transition">
                             <button onclick="downloadFile('\${f.key}')" class="text-emerald-400 hover:text-emerald-300">下载</button>
                             <button onclick="deleteFile('\${f.key}')" class="text-red-400 hover:text-red-300">删除</button>
                        </div>
                    </div>
                \`).join('');
            }

            async function upload() {
                const file = $('fileInput').files[0];
                if (!file) return;
                $('status').innerText = 'Uploading...';
                const formData = new FormData();
                formData.append('file', file);
                await fetch('/api/upload', { method: 'POST', body: formData, headers: { 'Authorization': pass } });
                $('status').innerText = 'Ready';
                loadFiles();
            }

            async function deleteFile(key) {
                if(!confirm('确定删除?')) return;
                await fetch('/api/delete?key=' + encodeURIComponent(key), { headers: { 'Authorization': pass } });
                loadFiles();
            }

            async function downloadFile(key) {
                const res = await fetch('/api/download?key=' + encodeURIComponent(key), { headers: { 'Authorization': pass } });
                const blob = await res.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = key;
                a.click();
            }
        </script>
    </body>
    </html>`
  )
})

// 后端 API 逻辑
app.use('/api/*', async (c, next) => {
  if (c.req.header('Authorization') !== c.env.ADMIN_PASS) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  await next()
})

app.get('/api/list', async (c) => {
  const list = await c.env.BUCKET.list()
  return c.json(list.objects)
})

app.post('/api/upload', async (c) => {
  const body = await c.req.parseBody()
  const file = body['file'] as File
  await c.env.BUCKET.put(file.name, await file.arrayBuffer())
  return c.json({ success: true })
})

app.get('/api/download', async (c) => {
    const key = c.req.query('key')
    const object = await c.env.BUCKET.get(key)
    if (!object) return c.notFound()
    const data = await object.arrayBuffer()
    return c.body(data)
})

app.get('/api/delete', async (c) => {
  const key = c.req.query('key')
  await c.env.BUCKET.delete(key)
  return c.json({ success: true })
})

export default app
