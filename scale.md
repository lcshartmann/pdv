# 5.3.1 Protocolo Prt1

A balança aguarda uma solicitação do dispositivo externo, para iniciar a transmissão de dados, relativa ao peso.

Este protocolo de comunicação utiliza:

- 1 Stop Bit;
- 8 Bits de dados;
- Sem paridade.

O envio dos dados é iniciado quando a balança receber o comando de solicitação "ENQ".

**ENQ** = Caractere ASCII (05H) enviado pelo dispositivo externo.

---

A partir deste comando e na condição de peso estável, a balança enviará ao dispositivo externo o seguinte pacote de dados:

[STX][PPPPP][ETX] onde:

- **STX** = Caractere ASCII (02H) – Início da transmissão.
- **PPPPP** = 5 caracteres ASCII relativos ao peso sem ponto decimal.
O ponto deve ser tratado via software.
- **ETX** = Caractere ASCII (03H) – Término da transmissão.
