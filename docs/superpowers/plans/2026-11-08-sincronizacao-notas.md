# Sincronização de notas entre aparelhos — Plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendada) ou superpowers:executing-plans para executar este plano tarefa por tarefa. Os passos usam checkbox (`- [ ]`).

**Objetivo:** o usuário entra com um link enviado por e-mail e suas notas aparecem sozinhas em todos os aparelhos dele.

**Arquitetura:** as notas continuam gravadas primeiro no `localStorage` (o app segue funcionando offline). Um módulo novo `sync.js`, sem dependências, fala com o Supabase por REST (Auth + PostgREST) e decide o que subir e o que baixar com uma função pura (`planSync`). A mais recentemente editada vence. O `index.html` só ganha a tela de conta e os gatilhos de sincronização.

**Tecnologias:** JavaScript puro (sem build), Supabase Auth (link mágico por e-mail) e PostgREST com RLS, `node --test` para testar `sync.js`. O projeto Supabase é o que o app já usa (`qqkvwspfsanzlogcvgwf`).

**Spec:** não há documento. O desenho foi aprovado no chat em 2026-11-08 e está resumido em "Decisões" abaixo.

## Decisões (aprovadas pelo usuário)

- Só o usuário usa, com os próprios aparelhos. Notas privadas por conta.
- Login por link no e-mail, sem senha.
- Sincronização automática, com uso offline como hoje.
- Conflito: vale a versão editada por último (`updated` maior).
- No primeiro login, as notas que já existem no aparelho sobem para a conta.
- Nota apagada num aparelho some nos outros.
- Fora do escopo: edição ao vivo entre aparelhos, compartilhar notas, histórico de versões, sincronizar as cores da caneta (`bn-cores`). O botão "Ao vivo" não muda.

**Escolhas minhas (não foram discutidas, o usuário pode revisar):** sincronizar também ao abrir o app, ao voltar o app para o primeiro plano, ao reconectar e ~3 s depois de salvar uma nota; falar com o Supabase por `fetch` em vez de usar `supabase-js`, igual ao `Live`; guardar uma "lápide" local para propagar exclusões.

## Restrições globais

- Sem frameworks, sem build, sem novas dependências. Os arquivos ficam na raiz e são servidos como estão pelo GitHub Pages.
- Textos de interface e mensagens de commit em português, como no histórico do repositório.
- Chaves do `localStorage`: `bn-sync` (sessão) e `bn-apagadas` (lápides, lista de `{id, updated}`). Prefixo `bn-` como as demais.
- Tabela `public.notes`, com RLS ligado e nenhuma policy para `anon`.
- Modo visualização (`?ver=`, a constante `VIEWER` em `index.html`) nunca autentica nem sincroniza.
- Não commitar segredos. A chave `anon` já está pública no `index.html`; não existe `service_role` neste projeto e ela não deve aparecer em lugar nenhum.

## Foco de revisão

Casos que o desenho implica, mas que nenhuma tarefa de "caminho feliz" exercita. Cada um tem teste na tarefa dona, indicada entre parênteses.

1. Aparelho novo abre o app e o `initNotes` cria uma nota vazia; ela não pode subir para a conta nem ficar misturada às notas baixadas (Tarefa 2, `isEmptyNote`; Tarefa 5, remoção do marcador).
2. Sem internet, com sessão vencida ou com o Supabase fora do ar, o app continua gravando local, mostra "offline" e não apaga nada (Tarefa 3, renovação de sessão falha; Tarefa 4, erros de rede).
3. Notas com `updated` igual dos dois lados não geram nenhuma ação (Tarefa 2). Relógios dessincronizados entre aparelhos podem fazer a edição mais antiga vencer: risco conhecido e aceito, a documentar na interface.
4. Nota apagada num aparelho enquanto outro a edita depois: a edição mais recente vence e a nota volta (Tarefa 2).
5. O link do e-mail abre no navegador errado ou numa janela sem o app: a sessão nasce no lugar onde o link foi aberto. A tela de conta explica isso, e o `#access_token` é removido da URL logo após ser lido (Tarefa 3; Tarefa 5).

---

### Tarefa 1: Tabela `notes` e RLS no Supabase

**Arquivos:**
- Criar: `supabase/migrations/20261108_notes.sql` (cópia versionada da migração aplicada)

**Interfaces:**
- Produz: tabela `public.notes` com colunas `user_id uuid` (default `auth.uid()`, not null), `id text`, `title text`, `custom boolean`, `updated bigint` (ms desde 1970, mesmo valor do índice local), `deleted boolean` (default false), `data jsonb` (`{boxes, strokes, pad}`), chave primária `(user_id, id)`. As tarefas 3 e 4 dependem desses nomes.

- [ ] **Passo 1: confirmar o projeto e listar as tabelas existentes**

Carregue as ferramentas do Supabase via ToolSearch (`mcp__claude_ai_Supabase__list_projects`, `list_tables`, `apply_migration`, `execute_sql`, `get_advisors`). Confirme que `qqkvwspfsanzlogcvgwf` está entre os projetos e que não existe tabela `notes` em `public`. Se o projeto não aparecer ou a tabela já existir, pare e pergunte ao usuário.

- [ ] **Passo 2: aplicar a migração `notes`**

Use `apply_migration` com o SQL abaixo e salve o mesmo texto em `supabase/migrations/20261108_notes.sql`:

```sql
create table public.notes (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null,
  title text not null default 'Nota sem título',
  custom boolean not null default false,
  updated bigint not null,
  deleted boolean not null default false,
  data jsonb not null default '{}'::jsonb,
  primary key (user_id, id)
);
alter table public.notes enable row level security;
create policy notes_owner_select on public.notes for select to authenticated using (user_id = (select auth.uid()));
create policy notes_owner_insert on public.notes for insert to authenticated with check (user_id = (select auth.uid()));
create policy notes_owner_update on public.notes for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy notes_owner_delete on public.notes for delete to authenticated using (user_id = (select auth.uid()));
```

- [ ] **Passo 3: provar o isolamento por usuário**

Com `execute_sql`, numa única transação com rollback: crie dois usuários de teste em `auth.users`, insira uma nota de cada um simulando `set local role authenticated` e `set local request.jwt.claims` com o `sub` de cada um, e confira que cada um enxerga só a própria nota e que `anon` não enxerga nenhuma. Resultado esperado: contagens 1, 1 e 0. Nada deve ficar gravado depois do rollback (confira com `select count(*) from public.notes` = 0).

- [ ] **Passo 4: rodar os avisos de segurança**

`get_advisors` (security). Esperado: nenhum aviso sobre `notes` (RLS ligado, sem policy permissiva para `anon`). Avisos que já existiam em outras tabelas não são desta tarefa; só reporte.

- [ ] **Passo 5: configurar o redirecionamento do login (manual, do usuário)**

No painel do Supabase, em Authentication → URL Configuration, o Site URL deve ser `https://rbs-prog.github.io/notepad-rbs/` e a mesma URL deve estar em Redirect URLs (mais `http://localhost:8000/` para testes locais). Peça ao usuário para conferir. Registre no relatório final que o envio de e-mail padrão do Supabase tem limite baixo por hora.

- [ ] **Passo 6: commit**

```bash
git add supabase/migrations/20261108_notes.sql
git commit -m "Cria tabela notes com RLS por usuário no Supabase"
```

---

### Tarefa 2: Decisão de sincronização (`planSync` e `isEmptyNote`)

**Arquivos:**
- Criar: `sync.js` (módulo clássico; no navegador expõe `window.Sync`, no node faz `module.exports`)
- Criar: `tests/sync.test.js`

**Interfaces:**
- Produz:
  - `planSync({ local, deleted, remote }) -> { pull: string[], push: string[], pushDelete: string[], dropLocal: string[], clearDeleted: string[] }`
    - `local`: `[{id, updated}]`, somente notas não vazias (quem chama já filtrou com `isEmptyNote`).
    - `deleted`: lápides `[{id, updated}]` (`updated` = momento da exclusão).
    - `remote`: `[{id, updated, deleted}]`.
  - `isEmptyNote(data) -> boolean`: verdadeiro para `data` nulo ou sem caixa com texto, sem traço e com `pad` vazio ou só espaço/tags vazias.

Regras de `planSync`, por `id` presente em qualquer das três listas:

| Remoto | Local | Resultado |
|---|---|---|
| ausente | nota | `push` |
| ausente | lápide | `clearDeleted` |
| viva | nota, remoto mais novo | `pull` |
| viva | nota, local mais novo | `push` |
| viva | nota, `updated` igual | nada |
| viva | lápide, lápide ≥ remoto | `pushDelete` + `clearDeleted` |
| viva | lápide, remoto mais novo | `pull` + `clearDeleted` (a edição mais recente vence e a nota volta) |
| viva | nenhum | `pull` |
| apagada | nota, local mais novo | `push` (a nota volta) |
| apagada | nota, remoto ≥ local | `dropLocal` |
| apagada | lápide | `clearDeleted` |
| apagada | nenhum | nada |

- [ ] **Passo 1: escrever os testes que falham em `tests/sync.test.js`**

Use `node:test` e `node:assert/strict`, importando `../sync.js`. Um teste por linha da tabela acima, com nomes `planSync: remoto ausente + nota local => push`, etc., cada um afirmando as cinco listas retornadas por `deepEqual`. Mais:
- `planSync: primeira entrada com remoto vazio sobe todas as notas locais` (3 notas locais, `remote: []` → `push` com os 3 ids).
- `planSync: updated igual não gera ação` (foco de revisão 3).
- `planSync: lápide mais antiga que a edição remota traz a nota de volta` (foco 4).
- `isEmptyNote: null, {}, caixas só com espaços e pad "<br>" são vazias; um traço, ou texto em caixa, ou texto no pad torna a nota não vazia` (foco 1).

- [ ] **Passo 2: rodar e ver falhar**

Run: `node --test tests/sync.test.js`
Esperado: falha, pois `sync.js` ainda não existe.

- [ ] **Passo 3: implementar `planSync` e `isEmptyNote` em `sync.js`**

Mapas por `id`; as listas retornadas não têm duplicatas e saem ordenadas por `id` para o teste ser determinístico. Termine o arquivo com a exportação dupla: `if (typeof module !== 'undefined') module.exports = Sync; else window.Sync = Sync;`, onde `Sync` é o objeto que as próximas tarefas vão ampliar.

- [ ] **Passo 4: rodar e ver passar**

Run: `node --test tests/sync.test.js`
Esperado: todos os testes passam.

- [ ] **Passo 5: commit**

```bash
git add sync.js tests/sync.test.js
git commit -m "Adiciona planSync: decide o que subir e baixar entre aparelhos"
```

---

### Tarefa 3: Autenticação por link no e-mail (`sync.js`)

**Arquivos:**
- Modificar: `sync.js`
- Modificar: `tests/sync.test.js`

**Interfaces:**
- Consome: nada da tarefa 2 além do objeto `Sync` exportado.
- Produz: `Sync.createClient({ url, key, fetch, storage }) -> client`, onde `fetch` e `storage` são injetáveis (no navegador, `window.fetch` e `window.localStorage`; nos testes, falsos). O cliente guarda a sessão em `storage` sob a chave `bn-sync`. Métodos desta tarefa:
  - `client.sendMagicLink(email: string, redirectTo: string) -> Promise<void>`: `POST {url}/auth/v1/otp` com `{ email, create_user: true }` e `redirect_to` na query. Rejeita com `Error` cuja `message` é o texto devolvido pelo Supabase.
  - `client.consumeRedirect(hash: string) -> { session, cleanHash: '' } | null`: lê `#access_token=…&refresh_token=…&expires_in=…`; `null` se o hash não trouxer token. Busca o usuário em `GET {url}/auth/v1/user` e grava `{ access_token, refresh_token, expires_at (s), user: { id, email } }`.
  - `client.session() -> Session | null`
  - `client.ensureFresh() -> Promise<Session | null>`: se faltam menos de 60 s para `expires_at`, faz `POST {url}/auth/v1/token?grant_type=refresh_token`. Se o refresh falhar por resposta 4xx, apaga a sessão e devolve `null`; se falhar por erro de rede, mantém a sessão e lança o erro.
  - `client.signOut() -> void`: apaga a sessão local (e tenta `POST /auth/v1/logout` sem esperar nem falhar).

- [ ] **Passo 1: escrever os testes que falham**

Com `fetch` falso que registra as chamadas e responde conforme o teste, e `storage` falso em memória:
- `sendMagicLink: envia e-mail e redirect_to para /auth/v1/otp`
- `sendMagicLink: erro do servidor vira Error com a mensagem recebida`
- `consumeRedirect: hash com token grava a sessão e devolve cleanHash vazio`
- `consumeRedirect: hash sem token devolve null e não grava nada`
- `ensureFresh: sessão válida não chama a rede`
- `ensureFresh: sessão perto de vencer renova e grava a nova`
- `ensureFresh: refresh recusado (400) apaga a sessão e devolve null` (foco 2)
- `ensureFresh: falha de rede mantém a sessão e lança` (foco 2)
- `signOut: apaga a sessão mesmo se o logout remoto falhar`

- [ ] **Passo 2: rodar e ver falhar**

Run: `node --test tests/sync.test.js`
Esperado: os novos testes falham (`createClient` não definido).

- [ ] **Passo 3: implementar o cliente de autenticação**

Todas as chamadas levam `apikey: key`. Chamadas autenticadas levam `Authorization: Bearer <access_token>`. Sem `supabase-js`.

- [ ] **Passo 4: rodar e ver passar**

Run: `node --test tests/sync.test.js`
Esperado: todos passam, incluindo os da tarefa 2.

- [ ] **Passo 5: commit**

```bash
git add sync.js tests/sync.test.js
git commit -m "Adiciona login por link no e-mail ao módulo de sincronização"
```

---

### Tarefa 4: Leitura e gravação de notas na nuvem (`sync.js`)

**Arquivos:**
- Modificar: `sync.js`
- Modificar: `tests/sync.test.js`

**Interfaces:**
- Consome: `client.ensureFresh()` da tarefa 3 (todas as chamadas abaixo a usam antes de ir à rede; sem sessão, lançam `Error('sem sessão')`).
- Produz, no mesmo `client`:
  - `client.listNotes() -> Promise<Array<{ id, updated, deleted }>>`: `GET {url}/rest/v1/notes?select=id,updated,deleted` (não traz `data`).
  - `client.getNote(id: string) -> Promise<{ id, title, custom, updated, deleted, data } | null>`: `GET …?id=eq.<id>&select=*`.
  - `client.putNote(n: { id, title, custom, updated, deleted, data }) -> Promise<void>`: `POST {url}/rest/v1/notes?on_conflict=user_id,id` com `Prefer: resolution=merge-duplicates`. Nunca envia `user_id` (vem do default do banco).

- [ ] **Passo 1: escrever os testes que falham**

Com o `fetch` falso:
- `listNotes: pede só id, updated e deleted`
- `getNote: devolve null quando não há linha`
- `putNote: usa upsert por user_id,id e não envia user_id`
- `putNote: resposta 401 renova uma vez e tenta de novo; segundo 401 lança`
- `listNotes: erro de rede lança e não altera a sessão guardada` (foco 2)
- `putNote: nota grande (data com 5 mil traços) vai inteira no corpo` (nenhum truncamento)

- [ ] **Passo 2: rodar e ver falhar**

Run: `node --test tests/sync.test.js`
Esperado: falham os novos testes.

- [ ] **Passo 3: implementar `listNotes`, `getNote` e `putNote`**

Reaproveite um único helper interno de requisição autenticada, em vez de repetir cabeçalhos e a nova tentativa após 401.

- [ ] **Passo 4: rodar e ver passar**

Run: `node --test tests/sync.test.js`
Esperado: todos passam.

- [ ] **Passo 5: commit**

```bash
git add sync.js tests/sync.test.js
git commit -m "Adiciona leitura e gravação de notas no Supabase ao módulo de sincronização"
```

---

### Tarefa 5: Tela de conta, lápides e gatilhos de sincronização no app

**Arquivos:**
- Modificar: `index.html` (painel `notesPanel` ~linha 124; camada `Store` ~linha 208; `renderNotes` ~linha 966; rodapé do script ~linha 996)
- Modificar: `sw.js` (adicionar `'sync.js'` à lista `FILES` do cache)

**Interfaces:**
- Consome: `Sync.createClient`, `Sync.planSync`, `Sync.isEmptyNote`, e os métodos do cliente das tarefas 3 e 4.
- Produz (em `index.html`):
  - `Store.tombs() -> Array<{id, updated}>`, `Store.addTomb(id)`, `Store.clearTombs(ids: string[])`, usando a chave `bn-apagadas`.
  - `Store.upsertMeta(meta: {id, title, custom, updated})`: grava no índice sem mexer no `updated` das outras notas.
  - `syncNow() -> Promise<void>`: no máximo uma execução por vez; não faz nada se `VIEWER` ou sem sessão.
  - `scheduleSync()`: chama `syncNow` 3 s depois da última chamada.

- [ ] **Passo 1: registrar a exclusão e a renomeação para a sincronização**

Em `renderNotes`, no botão de apagar, chame `Store.addTomb(n.id)` junto de `Store.del`. No botão de renomear, atualize `m.updated = Date.now()` (hoje só a nota atual é regravada; sem isso a renomeação de outra nota nunca sobe) e chame `scheduleSync()`. Chame `scheduleSync()` ao final de `saveNow()` e de `createNote()`.

- [ ] **Passo 2: carregar o módulo**

Adicione `<script src="sync.js"></script>` antes do `<script>` principal (linha 143) e `'sync.js'` na lista `FILES` de `sw.js`. Crie o cliente com `SUPA_HOST` e `SUPA_KEY` já definidos (`url: 'https://' + SUPA_HOST`).

- [ ] **Passo 3: painel de conta**

Dentro de `notesPanel`, acima de `notesList`, uma seção "Conta":
- Sem sessão: campo de e-mail, botão "Enviar link de acesso" (chama `sendMagicLink(email, location.origin + location.pathname)`), e a frase: "Abra o link no mesmo navegador/aparelho onde quer usar. Se o relógio dos aparelhos estiver diferente, a edição mais antiga pode vencer." Erros aparecem em `toast`.
- Com sessão: "Conectado como <e-mail>", status da última sincronização ("sincronizado às HH:MM", "sincronizando…", "offline — tentarei de novo") e botão "Sair" (`signOut`; as notas locais continuam no aparelho).
- Ao iniciar (fora de `VIEWER`), chame `consumeRedirect(location.hash)`; se retornar sessão, faça `history.replaceState(null, '', location.pathname + location.search)` para tirar o token da URL e chame `syncNow()`.

- [ ] **Passo 4: implementar `syncNow`**

1. `client.ensureFresh()`; sem sessão, sai. Erro de rede: status "offline" e sai, sem tocar nas notas.
2. Monte `local` com as notas do índice cuja `Store.get(id)` **não** satisfaz `Sync.isEmptyNote`; `deleted` com `Store.tombs()`; `remote` com `client.listNotes()`.
3. `Sync.planSync(...)` e execute: `pull` (`getNote` → `Store.put` + `Store.upsertMeta`), `push` (`Store.get` + meta → `putNote`, `deleted: false`), `pushDelete` (`putNote` com `deleted: true`, `data: {}`, `updated: Date.now()`), `dropLocal` (`Store.del` + remoção do índice), `Store.clearTombs(clearDeleted)`.
4. Remova a nota vazia criada pelo `initNotes` num aparelho novo: se depois do plano existir pelo menos uma nota não vazia e a nota vazia não foi editada, apague-a só localmente (sem lápide).
5. Se a nota aberta (`curId`) foi alterada por `pull` ou removida, chame `saveNow()` antes (para não perder edição pendente) e depois `loadNote` com a nota mais recente. Atualize `renderNotes()` se o painel estiver aberto.
6. Atualize o status e a hora da última sincronização.

- [ ] **Passo 5: gatilhos**

Chame `syncNow()` ao iniciar (após `initNotes()`), em `document.addEventListener('visibilitychange')` quando `document.visibilityState === 'visible'`, em `window.addEventListener('online')` e via `scheduleSync()` (passo 1).

- [ ] **Passo 6: verificação local sem login**

Run: `python -m http.server 8000` na raiz e abra `http://localhost:8000/` no Chrome.
Esperado: o app carrega como antes, sem erros no console; criar, editar, renomear e apagar notas funciona; o painel de conta mostra o campo de e-mail; nenhuma chamada de rede ao Supabase além do Realtime ao usar "Ao vivo". Abrir `http://localhost:8000/?ver=abc` não mostra o painel de conta e não chama `/auth/v1` nem `/rest/v1`.

- [ ] **Passo 7: verificação ponta a ponta (com o usuário)**

O usuário abre `http://localhost:8000/`, pede o link, abre-o no mesmo navegador e confirma:
1. As notas locais sobem (conferir com `execute_sql` em `public.notes`: uma linha por nota não vazia, `deleted = false`).
2. Num segundo navegador/perfil limpo, o mesmo login traz as notas e **não** deixa uma "Nota sem título" vazia extra (foco 1).
3. Editar no segundo e voltar ao primeiro (trocar de aba, para disparar `visibilitychange`) mostra a edição.
4. Apagar no segundo faz a nota sumir do primeiro (foco 4: depois de editar a nota antes de apagar, ver o que a regra faz).
5. Desligar a rede no DevTools: o app continua gravando; status "offline"; ao religar, sincroniza (foco 2).
Registre no relatório o que passou e o que não passou. Se o usuário não puder fazer agora, marque como pendente em vez de dar como concluído.

- [ ] **Passo 8: commit**

```bash
git add index.html sw.js
git commit -m "Sincroniza notas entre aparelhos com login por link no e-mail"
```

---

### Tarefa 6: Publicação e verificação em produção

**Arquivos:**
- Modificar: `README.md` (duas linhas: como funciona a sincronização e como rodar `node --test tests/sync.test.js`)

- [ ] **Passo 1: rodar a suíte inteira**

Run: `node --test tests/sync.test.js`
Esperado: todos passam.

- [ ] **Passo 2: atualizar o README e fazer commit**

```bash
git add README.md
git commit -m "Documenta a sincronização de notas no README"
```

- [ ] **Passo 3: publicar (só com autorização do usuário)**

Pergunte ao usuário antes de `git push origin main`. Depois do push, espere `gh api repos/rbs-prog/notepad-rbs/pages/builds/latest` mostrar `built` no commit novo.

- [ ] **Passo 4: conferir produção**

Compare os hashes de `index.html`, `sync.js` e `sw.js` publicados com os locais (`curl` com parâmetro aleatório para evitar cache) e abra `https://rbs-prog.github.io/notepad-rbs/` no Chrome: sem erro no console, painel de conta visível, `?ver=` sem painel de conta. Repita a verificação de ponta a ponta da tarefa 5, passo 7, em produção com o usuário e relate o resultado.
