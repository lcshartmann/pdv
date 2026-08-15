# Market POS — Documentação do Código

> Desktop point-of-sale para um mercado familiar. Construído com Electron + React + TypeScript + SQLite.

---

## Contexto do sistema

| Ator | Tipo | Papel |
|------|------|-------|
| Caixa | Pessoa | Opera vendas e processa pagamentos |
| Gerente | Pessoa | Visualiza relatórios e gerencia catálogo de produtos |
| Mercado Pago | Sistema externo | Pagamentos via cartão (Point) e PIX via API REST |
| Balança Prix 3 | Sistema externo | Leitura de peso via USB/serial (serialport) |
| Impressora térmica | Sistema externo | General Power 80mm — comandos ESC/POS via USB |

---

## Arquitetura de containers

**Plataforma:** Aplicativo desktop Electron (máquina única, armazenamento local, sem servidor).

| Container | Tecnologia | Responsabilidade |
|-----------|------------|----------------|
| React UI | React 18 + TypeScript | Tela de caixa, catálogo de produtos, relatórios e gráficos |
| Electron main process | Node.js + TypeScript | Regras de negócio, handlers IPC, coordenação de hardware, chamadas de API |
| SQLite database | better-sqlite3 | Todos os dados persistentes — produtos, vendas, pagamentos, estoque |
| Scale service | serialport (npm) | Leitura de peso estável da balança Prix 3 Toledo via USB/serial |
| Printer service | escpos (npm) | Envio de comandos ESC/POS para impressora General Power |
| Payment service | mercadopago (npm) | Geração de QR PIX, API Point para cartão, fallback PIX offline |

**Restrições principais:**

- O banco de dados **nunca** é acessado pelo processo renderer — todas as operações de DB passam pelos handlers IPC no main process.
- `contextIsolation: true` e `nodeIntegration: false` são obrigatórios em toda `BrowserWindow` (configurado em `src/main/index.ts`).
- Todos os canais IPC são tipados end-to-end via interfaces TypeScript compartilhadas em `/src/shared/types.ts`.
- O app funciona 100% offline para vendas em dinheiro. Apenas PIX e cartão exigem internet.

**Caminho de migração futuro:** A lógica de negócio em Node.js no main process pode ser extraída para um backend API server posteriormente com mínima refatoração, habilitando uma versão web ou multi-máquina.

---

## Modelo de dados

```sql
CREATE TABLE IF NOT EXISTS category (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS product (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT    NOT NULL,
  barcode          TEXT    UNIQUE,
  unit_type        TEXT    NOT NULL CHECK(unit_type IN ('unit', 'kg')),
  price_per_unit   REAL    NOT NULL CHECK(price_per_unit >= 0),
  stock_qty        REAL    NOT NULL DEFAULT 0 CHECK(stock_qty >= 0),
  stock_alert_qty  REAL    NOT NULL DEFAULT 0,
  category_id      INTEGER REFERENCES category(id),
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sale (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  status          TEXT NOT NULL DEFAULT 'open'
                    CHECK(status IN ('open', 'completed', 'cancelled')),
  subtotal        REAL NOT NULL DEFAULT 0,
  discount_amount REAL NOT NULL DEFAULT 0,
  total           REAL NOT NULL DEFAULT 0,
  started_at      TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at    TEXT
);

CREATE TABLE IF NOT EXISTS sale_item (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id         INTEGER NOT NULL REFERENCES sale(id),
  product_id      INTEGER NOT NULL REFERENCES product(id),
  quantity        REAL    NOT NULL CHECK(quantity > 0),
  unit_price      REAL    NOT NULL,
  discount_amount REAL    NOT NULL DEFAULT 0,
  total           REAL    NOT NULL
);

CREATE TABLE IF NOT EXISTS payment (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id       INTEGER NOT NULL REFERENCES sale(id),
  method        TEXT    NOT NULL CHECK(method IN ('cash', 'pix', 'card')),
  amount        REAL    NOT NULL,
  change_amount REAL    NOT NULL DEFAULT 0,
  mp_payment_id TEXT,
  status        TEXT    NOT NULL DEFAULT 'confirmed'
                  CHECK(status IN ('confirmed', 'pending')),
  paid_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stock_movement (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES product(id),
  type       TEXT    NOT NULL CHECK(type IN ('sale', 'restock', 'correction')),
  qty_change REAL    NOT NULL,
  reason     TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
```

**Decisões de design no schema:**

- `unit_type` é restrito a `'unit'` (venda por unidade) ou `'kg'` (venda por peso). A tela de caixa (`Sale.tsx`) usa esse campo para decidir entre exibir input de quantidade ou acionar a leitura da balança.
- `sale_item.unit_price` é copiado do produto no momento da venda — alterações de preço nunca afetam registros históricos.
- `sale_item.quantity` é `REAL` (float) para suportar tanto unidades inteiras quanto pesos em kg na mesma coluna.
- `sale.status` tem exatamente três valores: `open`, `completed`, `cancelled`. Vendas nunca são deletadas — apenas canceladas.
- `stock_movement` registra toda alteração de estoque como uma linha, habilitando trilha de auditoria completa e relatórios por período (ex: "350kg de tomates vendidos nos últimos 7 dias" = soma de movimentos `type = 'sale'` filtrados por data).
- `payment.mp_payment_id` armazena o ID de transação do Mercado Pago para reconciliação.
- `PRAGMA journal_mode = WAL` e `PRAGMA foreign_keys = ON` são executados em toda inicialização da conexão SQLite.

**Dados iniciais (seed):**

As categorias `["Hortifruti", "Laticínios", "Limpeza", "Bebidas", "Mercearia"]` são inseridas automaticamente se a tabela `category` estiver vazia no primeiro boot. Produtos de exemplo:

- Tomate — `unit_type: "kg"`, `price_per_unit: 6.9`, categoria: Hortifruti
- Leite Integral 1L — `barcode: "7891000100103"`, `unit_type: "unit"`, `price_per_unit: 4.5`, categoria: Laticínios
- Arroz 5kg — `barcode: "7896006700916"`, `unit_type: "unit"`, `price_per_unit: 24.9`, categoria: Mercearia

---

## Decisões de design

### Escolhas de tecnologia

| Decisão | Escolha | Motivo |
|---------|---------|--------|
| Framework desktop | Electron | Acesso nativo a porta serial (Prix 3), ecossistema Node.js, migração web fácil futuramente |
| Por que não Tauri | Rejeitado | Backend Rust exigido — sem SDK Mercado Pago, ecossistema serialport mais fino, curva de aprendizado íngreme para ganho prático nulo em máquina única |
| Banco de dados | SQLite via better-sqlite3 | Local, zero-config, sem dependência de rede, funciona offline |
| Provedor de pagamento | Mercado Pago | SDK oficial Node.js, PIX + Point em uma única API, amplamente usado no Brasil |
| Integração com balança | serialport (npm) | Prix 3 Toledo comunica via protocolo serial RS-232 sobre USB |
| Integração com impressora | escpos (npm) | ESC/POS é padrão universal para impressoras térmicas; funciona sem SDK proprietário |
| Idioma da UI | Português (PT-BR) | Mercado familiar no Brasil — UI deve ser nativa, não traduzida |

### Fluxos não-óbvios

**Fluxo de leitura da balança (happy path vs falha):**

- **Happy path:** Produto com `unit_type = "kg"` é selecionado → renderer invoca `scaleReadStableWeight()` via IPC → `ScaleService` aguarda peso estável (mínimo de 2 frames idênticos, configurável via `stableFramesRequired`) → retorna peso em kg com até 3 casas decimais → caixa confirma → item adicionado à venda.
- **Falha:** Se a balança está desconectada, o serviço faz polling USB a cada 1s (`usbPollIntervalMs: 1000`), tenta reconectar a cada 1.5s (`reconnectDelayMs: 1500`), e rejeita leituras pendentes com erro `"Balança desconectada."`. A UI (`Sale.tsx`) captura o erro e oferece entrada manual de peso. O serviço aceita portas configuráveis via `SCALE_PORT` ou default `/dev/ttyUSB0`.

**Fluxo de pagamento em dinheiro (happy path vs falha):**

- **Happy path:** Caixa pressiona F3 → modal abre com valor total pré-preenchido (`subtotal.toFixed(2).replace(".", ",")`) → caixa informa valor recebido → troco calculado em tempo real (`change = received - subtotal`) → confirma → `payment:create` com `method: "cash"` e `change_amount` → `sale:complete` → estoque decrementado, `stock_movement` registrado com `type = 'sale'` e `reason = "sale:${saleId}"`, recibo impresso (via `PrinterService`).
- **Falha:** Se valor recebido < total, botão de confirmação fica desabilitado (`isCashConfirmDisabled`). Se a venda não está `open`, o modal não abre. Erros de IPC exibem mensagem em vermelho (`text-[#ff8d8d]`) no modal.

**Fallback PIX offline (documentado em `market-pos-docs.md`, serviço ainda stub):**

- **Online:** Mercado Pago API gera QR dinâmico → cliente escaneia → app detecta confirmação → venda completa automaticamente.
- **Offline:** QR estático gerado localmente com chave PIX da loja e total da venda embutido → impresso no recibo → caixa verifica app do banco → confirma manualmente → venda completa. O `payment.status` é `confirmed` diretamente (o caixa age como camada de confirmação). O arquivo `payment_flows.html` contém o mockup visual deste fluxo.

**Decremento de estoque no fechamento de venda:**

- Durante `sale:complete`, a transação SQLite itera pelos itens da venda e executa `UPDATE product SET stock_qty = stock_qty - ?` e `INSERT INTO stock_movement (product_id, type, qty_change, reason) VALUES (?, 'sale', ?, ?)`.
- **Proteção contra estoque negativo:** Se `quantity > stock_qty`, o decremento limita-se ao `stock_qty` disponível (`qty = min(quantity, stock_qty)`). Isso previne estoque negativo, mas não bloqueia a venda — a venda completa mesmo com estoque insuficiente.

**Reimpressão de recibo:**

- `reports:reprintReceipt` verifica existência da venda no banco e delega a `PrinterService.printReceipt()`. Atualmente é um stub — TODO comentado no código indica integração futura com `escpos`.

---

## Design system & paleta

### Tokens de cor

| Token | Valor | Uso |
|-------|-------|-----|
| Background | `#111318` | Fundo do app (`bg-[#111318]`) |
| Surface | `#22262f` | Cards, inputs (`bg-[#22262f]`) |
| Panel | `#1a1d24` | Sidebar, painel direito (`bg-[#1a1d24]`) |
| Border | `#2a2d35` | Divisores, bordas sutis (`border-[#2a2d35]`) |
| Primary (teal) | `#1D9E75` | Ações, sucesso, confirmar (`bg-[#1D9E75]`, `text-[#1D9E75]`) |
| Danger (vermelho) | `#E24B4A` | Cancelar, erro, sem estoque (`text-[#E24B4A]`, `border-[#E24B4A]`) |
| Warning (amber) | `#EF9F27` | PIX, estoque baixo (`text-[#EF9F27]`, `border-[#EF9F27]`) |
| Info (azul) | `#378ADD` | Cartão, informativo (`text-[#378ADD]`, `border-[#378ADD]`) |
| Text primary | `#e8e6df` | Conteúdo principal (`text-[#e8e6df]`) |
| Text secondary | `#c2c0b6` | Texto de suporte (`text-[#c2c0b6]`) |
| Text muted | `#6b6a65` | Labels, metadados (`text-[#6b6a65]`) |
| Scale connected | `#00b386` | Indicador de balança conectada (`bg-[#00b386]`) |
| Scale disconnected | `#ff6f99` | Indicador de balança desconectada (`bg-[#ff6f99]`) |
| Sale open | `#7fd1b6` | Status "Aberta" |
| Sale completed | `#7dc8ff` | Status "Concluída" |
| Sale cancelled | `#ff6f99` | Status "Cancelada" |

### Tipografia

| Papel | Tamanho | Peso | Exemplo |
|-------|---------|------|---------|
| Display / total | `32px` | `500` | `R$ 47,90` (classe `text-4xl font-medium`) |
| Heading | `16px` | `500` | `Venda #0042` (classe `text-lg font-medium`) |
| Body | `14px` | `400` | `Tomate · 1,350 kg × R$ 6,90/kg` (classe `text-sm` / `text-[13px]`) |
| Label / meta | `12px` | `400` | `14:32 · Dinheiro · Troco R$ 2,10` (classe `text-xs` / `text-[12px]`) |
| Kbd / badge | `10px` | `400` | `F1` (classe `text-[10px]`) |

### Border radius

- `4px` — tags, pills, badges (`rounded`, `rounded-md` com override)
- `8px` — inputs, botões (`rounded-md` / `rounded-lg`)
- `12px` — cards, panels, modais (`rounded-xl`)

### Atalhos de teclado (funcionais no código)

| Tecla | Ação | Localização no código |
|-------|------|----------------------|
| `F1` | Nova venda (reseta tela de caixa) | `Sale.tsx` (keyDown listener) |
| `F1` | Navegar para tela de Venda | `App.tsx` (`KeyboardPageNavigation`) |
| `F2` | Foco no campo de busca / código de barras | `Sale.tsx` e `Catalog.tsx` |
| `F3` | Abrir modal de pagamento em dinheiro | `Sale.tsx` |
| `F6` | Navegar para tela Produtos | `App.tsx` |
| `F7` | Navegar para tela Relatórios | `App.tsx` |
| `F8` | Novo produto (na tela Produtos) | `Catalog.tsx` |
| `Esc` | Fechar modal aberto ou abrir cancelamento de venda | `Sale.tsx` |
| `Enter` | Confirmar modal atual (cash, unit, weight, edit) | Vários modais em `Sale.tsx` |

> **Nota:** Os botões de PIX e Cartão exibem badges `F4` e `F5` na UI, mas não há handlers `keydown` funcionais para essas teclas no código. As teclas `E` (editar) e `Del` (remover) existem apenas como rótulos de botões, não como atalhos de teclado globais.

---

## User stories & critérios de aceitação

> As histórias abaixo foram encontradas no arquivo `market-pos-docs.md` (parte do codebase) e nos comentários do código (`Catalog.tsx`).

### SALE-01 · Iniciar nova venda · Must
> Como caixa, quero iniciar uma nova sessão de venda para registrar os itens de um cliente.
- Botão "Nova venda" (F1) sempre acessível na tela de caixa.
- Ao clicar, limpa estado anterior e abre venda em branco.
- Timestamp `started_at` registrado imediatamente.
- Status da venda definido como `open`.

### SALE-02 · Adicionar item por leitura de código de barras · Must
> Como caixa, quero escanear o código de barras de um produto para que ele seja adicionado à venda automaticamente.
- Scan de código busca produto no banco.
- Se encontrado, adicionado com quantidade 1 e preço atual.
- Se escaneado novamente, quantidade incrementa em 1.
- Se não encontrado, exibe alerta "Produto não encontrado".
- Total atualiza imediatamente após cada scan.

### SALE-03 · Adicionar item por peso (balança) · Must
> Como caixa, quero colocar um item na balança e ter seu peso lido automaticamente.
- Após seleção de produto com `unit_type = "kg"`, app aguarda leitura estável da Prix 3.
- Peso (em kg, até 3 decimais) exibido na tela antes da confirmação.
- Caixa pode confirmar ou re-ler o peso.
- Preço calculado como `peso × price_per_unit` e adicionado à venda.
- Se balança desconectada, exibe erro e oferece entrada manual de peso.

### SALE-04 · Adicionar item manualmente · Must
> Como caixa, quero buscar e adicionar produto por nome para itens sem código de barras.
- Campo de busca (F2) permite digitar nome e exibe lista filtrada em tempo real.
- Selecionar produto da lista o adiciona à venda.
- Para `unit_type = "kg"`, aciona fluxo de leitura da balança.
- Para `unit_type = "unit"`, input de quantidade default 1.

### SALE-05 · Remover ou ajustar item · Must
> Como caixa, quero remover ou ajustar a quantidade de um item para corrigir erros.
- Cada item tem botão "E" (editar) e "Del" (remover).
- Editar abre modal de input de quantidade.
- Total recalculado imediatamente.
- Remover todos os itens deixa venda vazia (sessão permanece aberta, não cancelada).

### SALE-06 · Aplicar desconto · Should
> Como caixa, quero aplicar desconto na venda ou item para promoções.
- Desconto pode ser percentual ou valor fixo.
- Aplicado em nível de venda ou item.
- Valor de desconto exibido separadamente.
- Armazenado em `sale.discount_amount` ou `sale_item.discount_amount`.

### SALE-07 · Cancelar venda · Must
> Como caixa, quero cancelar uma venda aberta se o cliente desistir.
- Botão "Cancelar" (Esc) disponível em qualquer venda aberta.
- Diálogo de confirmação previne cancelamentos acidentais.
- Status definido como `cancelled` — nunca deletado.
- Nenhum movimento de estoque registrado para venda cancelada.

### PAY-01 · Pagar em dinheiro · Must
> Como caixa, quero registrar pagamento em dinheiro e calcular troco.
- Caixa informa valor recebido (F3).
- Sistema calcula e exibe troco em tempo real.
- Valor recebido deve ser ≥ total da venda — botão de confirmação desabilitado caso contrário.
- Ao confirmar: status → `completed`, pagamento salvo, estoque decrementado, recibo impresso.

### PAY-02 · Pagar com PIX · Must
> Como caixa, quero gerar QR code PIX para pagamento instantâneo.
- App chama API Mercado Pago para gerar QR dinâmico (F4).
- QR exibido na tela para cliente escanear.
- App polla por confirmação e mostra sucesso automaticamente.
- Se internet indisponível, QR estático gerado localmente com chave PIX da loja e total embutido.
- Recibo offline declara: "PIX pendente — escaneie o QR code para pagar R$ X,XX".
- Botão "Recebi o PIX — confirmar venda" permite caixa confirmar manualmente após verificar app do banco.

### PAY-03 · Pagar com cartão (Mercado Pago Point) · Must
> Como caixa, quero enviar total da venda para a maquininha.
- App envia intenção de pagamento à API Point (F5).
- Maquininha interage com cliente independentemente.
- App recebe confirmação da API e fecha venda automaticamente.
- Se maquininha inacessível, exibe erro e permite retry ou troca de método.

### PAY-04 · Imprimir recibo · Must
> Como caixa, quero que o recibo seja impresso automaticamente após pagamento.
- Recibo imprime automaticamente na conclusão da venda.
- Inclui: nome da loja, data/hora, lista de itens, total, forma de pagamento, troco.
- Se impressora offline, exibe aviso e permite retry manual.
- Guilhotina corta o papel após impressão.

### PROD-01 · Registrar novo produto · Must
> Como gerente, quero registrar um novo produto para vendê-lo no caixa.
- Formulário requer: nome, preço, tipo de unidade, categoria.
- Código de barras opcional — pode ser escaneado ou digitado.
- Códigos duplicados rejeitados com mensagem clara (constraint `SQLITE_CONSTRAINT_UNIQUE` capturada em `ipc.ts`).
- Threshold de alerta de estoque configurável (default 0).
- Produto imediatamente disponível após salvar.

### PROD-02 · Atualizar preço de produto · Must
> Como gerente, quero atualizar o preço de um produto.
- Preço editável na lista de produtos.
- Novo preço aplica-se apenas a vendas futuras — itens de vendas passadas não afetados.
- `updated_at` atualizado no save.

### PROD-03 · Entrada de estoque · Must
> Como gerente, quero registrar entrada de estoque.
- Gerente seleciona produto e informa quantidade recebida.
- Registro `stock_movement` criado com `type = "restock"`.
- `stock_qty` do produto incrementado.
- Se produto estava abaixo do threshold, alerta de estoque baixo é limpo.

### PROD-04 · Alerta de estoque baixo · Should
> Como gerente, quero ser alertado quando um produto estiver acabando.
- Após cada venda, estoque verificado contra `stock_alert_qty`.
- Produtos abaixo do threshold destacados na lista com badge de aviso.
- Resumo de produtos com estoque baixo visível no dashboard.

### REP-01 · Resumo de vendas diárias · Must
> Como gerente, quero ver o resumo de vendas de hoje.
- Dashboard mostra: total de vendas, receita total, breakdown por forma de pagamento.
- Dados refletem apenas vendas `completed` — canceladas excluídas.
- Data pode ser alterada para visualizar dias passados.

### REP-02 · Produtos mais vendidos · Must
> Como gerente, quero ver quais produtos vendem mais.
- Gráfico de barras top 10 por receita ou quantidade vendida.
- Toggle entre "por receita (R$)" e "por quantidade (unidades ou kg)".
- Filtro de período: hoje, 7 dias, 15 dias, 30 dias, custom.

### REP-03 · Quantidade vendida por produto · Must
> Como gerente, quero ver quanto de um produto específico foi vendido no período.
- Gerente seleciona produto e período.
- Total vendido exibido na unidade correta (kg ou unidades).
- Gráfico de linha mostra quantidade por dia (ou por período de 2h se intervalo ≤ 2 dias).
- Receita total do produto no período também exibida.

### REP-04 · Histórico de vendas · Should
> Como gerente, quero navegar vendas passadas.
- Lista de vendas filtrável por período e forma de pagamento.
- Clique exibe detalhes: itens, quantidades, preços, pagamento, timestamps.
- Vendas canceladas exibidas com indicador visual distinto.
- Recibo pode ser reimpresso da tela de detalhes.

---

## Ordem de build & dependências

| Fase | Módulos | Depende de | Observações |
|------|---------|------------|-------------|
| 1 | Setup Electron, schema SQLite, design system | Nada | Totalmente independente — pode ser construído em paralelo |
| 2 | Catálogo de produtos, tela de caixa (SALE-01–05), pagamento em dinheiro (PAY-01) | Fase 1 | Catálogo deve vir antes da tela de caixa. Pagamento em dinheiro fecha um loop testável completo. |
| 3 | Balança (SALE-03), impressora (PAY-04), Mercado Pago PIX + cartão (PAY-02, 03) | Fase 2 | Todos exigem hardware físico ou credenciais externas. Stubbed na fase 1. |
| 4 | Relatórios (REP-01–04) | Fase 3 | Significativos apenas após dados reais de vendas existirem. |

> Após a fase 2, o app já é utilizável para vendas em dinheiro no mercado. Fases 3 e 4 agregam sobre uma baseline funcional.

---

## Restrições absolutas — nunca violar

- **Nunca acesse o banco de dados pelo processo renderer.** Todas as operações de DB devem passar por handlers IPC no `main` process (`src/main/ipc.ts`).
- **`contextIsolation: true` e `nodeIntegration: false`** são obrigatórios em toda `BrowserWindow` (configurado em `src/main/index.ts`).
- **Todos os canais IPC devem ser tipados end-to-end** usando interfaces compartilhadas em `/src/shared/types.ts`.
- **Não deletar vendas.** Apenas alterar status para `cancelled`. Vendas são permanentes para auditoria.
- **`sale_item.unit_price` congelado no momento da venda.** Nunca atualizar preços históricos.
- **`sale_item.quantity` deve ser > 0.** Validado via `CHECK(quantity > 0)` no schema e re-validado nos handlers IPC.
- **Descontos devem ser armazenados em colunas separadas** (`sale.discount_amount` / `sale_item.discount_amount`), não subtraídos silenciosamente do total.
- **`stock_movement` deve registrar todo decremento/incremento de estoque** com `type` explícito (`sale`, `restock`, `correction`) e `reason`.
- **O app deve funcionar offline para vendas em dinheiro.** Sem dependência de internet para o loop básico de venda.
- **`payment.status` para vendas em dinheiro deve ser `confirmed`** — o caixa é a camada de confirmação.
- **`product.barcode` é UNIQUE.** Duplicados devem ser rejeitados com mensagem em português: `"Código de barras já cadastrado."`.
- **O campo `sale.completed_at` só é preenchido em vendas `completed` ou `cancelled`.** Vendas `open` têm `completed_at` nulo.
- **Stock nunca deve ficar negativo no decremento.** A lógica em `sale:complete` limita o decremento ao `stock_qty` disponível (`qty = min(quantity, stock_qty)`).
- **Modal aberto bloqueia navegação por F1/F6/F7.** O `document.body.dataset.posModalOpen` é usado para suprimir atalhos de navegação quando modais estão abertos.
