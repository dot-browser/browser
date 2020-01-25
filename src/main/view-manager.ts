import { ipcMain } from 'electron';
import { TOOLBAR_HEIGHT } from '../renderer/views/app/constants';
import { windowsManager } from '.';
import { View } from './view';

declare const global: any;

global.viewsMap = {};

export class ViewManager {
  public views: { [key: number]: View } = {};
  public selectedId = 0;
  public _fullscreen = false;

  public isHidden = false;

  public get fullscreen() {
    return this._fullscreen;
  }

  public set fullscreen(val: boolean) {
    this._fullscreen = val;
    this.fixBounds();
  }

  constructor() {
    ipcMain.on(
      'browserview-create',
      (e: Electron.IpcMainEvent, { tabId, url }: any) => {
        this.create(tabId, url);

        windowsManager.window.webContents.send(
          `browserview-created-${tabId}`,
          this.views[tabId].id,
        );
      },
    );

    ipcMain.on(
      'browserview-select',
      (e: Electron.IpcMainEvent, id: number) => {
        const view = this.views[id];
        this.select(id);
        view.updateNavigationState();
      },
    );

    ipcMain.on(
      'browserview-destroy',
      (e: Electron.IpcMainEvent, id: number) => {
        this.destroy(id);
      },
    );

    ipcMain.on('browserview-call', async (e: any, data: any) => {
      const view = this.views[data.tabId];
      let scope: any = view;

      if (data.scope && data.scope.trim() !== '') {
        const scopes = data.scope.split('.');
        try {
          for (const s of scopes) {
            scope = scope[s];
          }

          let result = scope.apply(view.webContents, data.args);

          if (result instanceof Promise) {
            result = await result;
          }

          if (data.callId) {
            windowsManager.window.webContents.send(
              `browserview-call-result-${data.callId}`,
              result,
            );
          }
        } catch (e) {}
      }
    });

    ipcMain.on('browserview-hide', () => {
      this.hideView();
    });

    ipcMain.on('browserview-show', () => {
      this.showView();
    });

    setInterval(() => {
      for (const key in this.views) {
        const view = this.views[key];
        const title = view.webContents.getTitle();
        const url = view.webContents.getURL();

        if (title !== view.title) {
          windowsManager.window.webContents.send(`browserview-data-updated-${key}`, {
            title,
            url,
          });
          view.url = url;
          view.title = title;
        }
      }
    }, 200);

    ipcMain.on('browserview-clear', () => {
      this.clear();
    });
  }

  public get selected() {
    return this.views[this.selectedId];
  }

  public create(tabId: number, url: string) {
    const view = new View(tabId, url);
    this.views[tabId] = view;
    global.viewsMap[view.id] = tabId;
  }

  public clear() {
    windowsManager.window.setBrowserView(null);
    for (const key in this.views) {
      this.destroy(parseInt(key, 10));
    }
  }

  public newTabView() {
    for (const key in this.views) {
      if (
        this.views[key].webContents
          .getURL()
          .startsWith('dot://newtab')
      ) {
        return this.views[key];
      }
    }
  }

  public select(tabId: number) {
    const view = this.views[tabId];
    this.selectedId = tabId;

    if (!view || view.isDestroyed()) {
      this.destroy(tabId);
      windowsManager.window.setBrowserView(null);
      return;
    }

    if (this.isHidden) return;

    windowsManager.window.setBrowserView(view);

    const currUrl = view.webContents.getURL();

    if (
      (currUrl === '' && view.homeUrl === 'about:blank') ||
      currUrl === 'about:blank'
    ) {
      windowsManager.window.webContents.focus();
    } else {
      view.webContents.focus();
    }

    this.fixBounds();
  }

  public fixBounds() {
    const view = this.views[this.selectedId];

    if (!view) return;

    const { width, height } = windowsManager.window.getContentBounds();
    view.setBounds({
      x: 0,
      y: this.fullscreen ? 0 : TOOLBAR_HEIGHT + 1,
      width,
      height: this.fullscreen ? height : height - TOOLBAR_HEIGHT,
    });
    view.setAutoResize({ width: true, height: true, horizontal: false, vertical: false });
  }

  public hideView() {
    this.isHidden = true;
    windowsManager.window.setBrowserView(null);
  }

  public showView() {
    this.isHidden = false;
    this.select(this.selectedId);
  }

  public destroy(tabId: number) {
    const view = this.views[tabId];

    if (!view || view.isDestroyed()) {
      delete this.views[tabId];
      return;
    }

    if (windowsManager.window.getBrowserView() === view) {
      windowsManager.window.setBrowserView(null);
    }

    view.destroy();

    delete this.views[tabId];
  }

  sendToAll(name: string, ...args: any[]) {
    for (const key in this.views) {
      const view = this.views[key];
      view.webContents.send(name, ...args);
    }
  }
}
