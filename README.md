# Wake2Play

A [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader) plugin for the Steam Deck
that puts your Steam Remote Play host PC to sleep when the Deck sleeps, wakes it when the
Deck wakes, and reconnects the stream to the game you were playing — which is still running,
frozen in the PC's memory.

- Plugin source, host (Windows) setup and deploy instructions: [`Wake2Play/README.md`](Wake2Play/README.md)
- History: [`CHANGELOG.md`](CHANGELOG.md)
- `tools/cdp_eval.py`: tiny stdlib-only Chrome DevTools client used to evaluate JS in the
  Steam UI over SSH (deploy/reload and debugging).
