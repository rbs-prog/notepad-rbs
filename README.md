# Notepad RBS
Sandbox para desenvolver pelo celular (Claude Code na web/app)

## Sincronização entre aparelhos
Entre com seu e-mail (link, sem senha) no painel "Notas" e as notas sincronizam sozinhas pelo Supabase; a edição mais recente vence. A tabela está em `supabase/migrations/`.
Testes do módulo `sync.js`: `node --test tests/sync.test.js`
