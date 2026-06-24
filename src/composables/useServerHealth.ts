import { onMounted, ref } from 'vue';

export function useServerHealth() {
  const serverReady = ref(true);
  const serverHint = ref('');

  async function checkServerHealth() {
    try {
      const res = await fetch('/api/health');
      if (!res.ok) throw new Error('health not ok');
      await res.json();
      serverReady.value = true;
      serverHint.value = '';
    } catch {
      serverReady.value = false;
      serverHint.value =
        '无法连接后端服务。请新开终端在项目目录执行 npm start（仅开发前端时还需 npm run dev；或直接 npm run boot 访问 http://localhost:3457）';
    }
  }

  onMounted(() => {
    checkServerHealth();
  });

  return { serverReady, serverHint, checkServerHealth };
}

function networkErrorMessage() {
  return '无法连接后端服务。请先运行 npm start；开发模式需同时运行 npm start 与 npm run dev，或使用 npm run boot。';
}

export function isNetworkFetchError(err: unknown) {
  return err instanceof TypeError || String(err).includes('Failed to fetch');
}

export function wrapNetworkError(err: unknown): Error {
  if (isNetworkFetchError(err)) return new Error(networkErrorMessage());
  if (err instanceof Error) return err;
  return new Error(String(err));
}
