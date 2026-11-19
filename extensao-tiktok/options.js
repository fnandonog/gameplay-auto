const $ = (s) => document.querySelector(s);
async function mostrar() {
  const { codigo, vistoEm, ultimoErro, ultimoPost, versaoPainel } = await chrome.storage.local.get(['codigo', 'vistoEm', 'ultimoErro', 'ultimoPost', 'versaoPainel']);
  const minha = chrome.runtime.getManifest().version;
  $('#versao').textContent = versaoPainel && versaoPainel !== minha
    ? `Versão ${minha}. A pasta extensao-tiktok tem a ${versaoPainel}: em chrome://extensions clique em ↻ nesta extensão.`
    : `Versão ${minha}.`;
  if (codigo) $('#codigo').placeholder = 'guardado (cole só para trocar)';
  const post = ultimoPost ? ` Último vídeo ${new Date(ultimoPost.em).toLocaleString('pt-BR')}: ${ultimoPost.ok ? 'publicado' : `parou em "${ultimoPost.etapa}" (${ultimoPost.erro})`}.` : '';
  $('#estado').className = ultimoErro ? 'erro' : 'muted';
  $('#estado').textContent = ultimoErro || (vistoEm ? `Falou com a central ${new Date(vistoEm).toLocaleString('pt-BR')}.${post}` : codigo ? 'Ainda não falou com a central (o painel na porta 4322 está aberto?).' : '');
}
$('#f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const v = $('#codigo').value.trim();
  if (v) await chrome.storage.local.set({ codigo: v });
  $('#codigo').value = '';
  $('#estado').textContent = 'Conferindo...';
  await chrome.runtime.sendMessage('agora');
  await mostrar();
});
mostrar();
