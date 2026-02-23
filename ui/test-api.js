import { invoke } from '@tauri-apps/api/core';
const res = await invoke('doc_open', { path: '/tmp/test.pdf' });
console.log(res);
