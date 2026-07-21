# BFMIDI Demo

Demonstração interativa do editor BFMIDI Project Zero. Esta versão funciona
inteiramente no navegador: não procura uma controladora física, não abre Wi‑Fi
e não usa Web Serial/USB.

## O que a demonstração oferece

- editor completo de bancos, presets, LIVE MODE e configurações globais;
- memória local persistente no navegador;
- simulador responsivo da controladora selecionada;
- display virtual para os modos PRESET e LIVE;
- footswitches virtuais, LEDs e troca de bancos/presets;
- backup, restauração e opção para reiniciar a demonstração.

## Desenvolvimento

```bash
npm install
npm run dev
```

O modo de desenvolvimento atualiza a pasta `dist/`. Sirva essa pasta com um
servidor HTTP local para abrir a aplicação.

## Publicação

Cada envio para a branch `main` gera a aplicação e publica o conteúdo da pasta
`dist/` no GitHub Pages. Ative **Settings → Pages → Source: GitHub Actions** uma
única vez no repositório.

Os dados criados por cada visitante ficam somente no navegador dele.
