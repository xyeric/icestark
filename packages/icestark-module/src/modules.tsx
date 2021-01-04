import Sandbox, { SandboxProps, SandboxContructor } from '@ice/sandbox';
import ModuleLoader, { StarkModule } from './loader';

export type ISandbox = boolean | SandboxProps | SandboxContructor;

let globalModules = [];
let importModules = {};
// store css link
const cssStorage = {};

const IS_CSS_REGEX = /\.css(\?((?!\.js$).)+)?$/;
export const moduleLoader = new ModuleLoader();

export const registerModules = (modules: StarkModule[]) => {
  modules.forEach(m => {
    if(!m.url && !m.render) {
      console.log('[icestark module] url and render cannot both be empty. name: %s', m.name);
    }
  });

  globalModules = modules;
};

export const clearModules = () => {
  // reset module info
  globalModules = [];
  importModules = {};
  moduleLoader.clearTask();
};

// if css link already loaded, record load count
const filterAppendCSS = (cssList: string[]) => {
  return (cssList || []).filter((cssLink) => {
    if (cssStorage[cssLink]) {
      cssStorage[cssLink] += 1;
      return false;
    } else {
      cssStorage[cssLink] = 1;
      return true;
    }
  });
};

const filterRemoveCSS = (cssList: string[]) => {
  return (cssList || []).filter((cssLink) => {
    if (cssStorage[cssLink] > 1) {
      cssStorage[cssLink] -= 1;
      return false;
    } else {
      delete cssStorage[cssLink];
      return true;
    }
  });
};

/**
 * support react module render
 */
const defaultMount = () => {
  console.error('[icestark module] Please export mount function');
};

/**
 * default unmount function
 */
const defaultUnmount = () => {
  console.error('[icestark module] Please export unmount function');
};

function createSandbox(sandbox: ISandbox) {
  let moduleSandbox = null;
  if (sandbox) {
    if (typeof sandbox === 'function') {
      // eslint-disable-next-line new-cap
      moduleSandbox = new sandbox();
    } else {
      const sandboxProps = typeof sandbox === 'boolean' ? {} : sandbox;
      moduleSandbox = new Sandbox(sandboxProps);
    }
  }
  return moduleSandbox;
}

/**
 * parse url assets
 */
export const parseUrlAssets = (assets: string | string[]) => {
  const jsList = [];
  const cssList = [];
  (Array.isArray(assets) ? assets : [assets]).forEach(url => {
    const isCss: boolean = IS_CSS_REGEX.test(url);
    if (isCss) {
      cssList.push(url);
    } else {
      jsList.push(url);
    }
  });

  return { jsList, cssList };
};


export function appendCSS(
  name: string,
  url: string,
  root: HTMLElement | ShadowRoot = document.getElementsByTagName('head')[0],
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    if (!root) reject(new Error(`no root element for css assert: ${url}`));

    const element: HTMLLinkElement = document.createElement('link');
    element.setAttribute('module', name);
    element.rel = 'stylesheet';
    element.href = url;

    element.addEventListener(
      'error',
      () => {
        console.error(`css asset loaded error: ${url}`);
        return resolve();
      },
      false,
    );
    element.addEventListener('load', () => resolve(), false);

    root.appendChild(element);
  });
}

/**
 * remove css
 */

export function removeCSS(name: string, node?: HTMLElement | Document, removeList?: string[]) {
  const linkList: NodeListOf<HTMLElement> = (node || document).querySelectorAll(
    `link[module=${name}]`,
  );
  linkList.forEach(link => {
    // check link href if it is in remove list
    // compatible with removeList is undefined
    if (removeList && removeList.includes(link.getAttribute('href')) || !removeList) {
      link.parentNode.removeChild(link);
    }
  });
}

/**
 * return globalModules
*/
export const getModules = function () {
  return globalModules || [];
};

/**
 * load module source
 */

export const loadModule = async(targetModule: StarkModule, sandbox?: ISandbox) => {
  const { name, url, render } = targetModule;
  let moduleSandbox = null;
  if (!importModules[name]) {
    if (url) {
      const { jsList, cssList } = parseUrlAssets(url);
      moduleSandbox = createSandbox(sandbox);
      const moduleInfo = await moduleLoader.execModule({ name, url: jsList }, moduleSandbox);
      importModules[name] = {
        moduleInfo,
        moduleSandbox,
        moduleCSS: cssList,
      };
    } else if (render && typeof render === 'function') {
      importModules[name] = {
        moduleInfo: targetModule,
      };
    }
  }

  const { moduleInfo, moduleCSS } = importModules[name];

  if (!moduleInfo) {
    const errMsg = 'load or exec module faild';
    console.error(errMsg);
    return Promise.reject(new Error(errMsg));
  }

  const mount = targetModule.mount || moduleInfo?.mount || defaultMount;
  const component = moduleInfo.default || render || moduleInfo;

  // append css before mount module
  if (moduleCSS) {
    const cssList = filterAppendCSS(moduleCSS);
    if (cssList.length) {
      await Promise.all(cssList.map((css: string) => appendCSS(name, css)));
    }
  }

  return {
    mount,
    component,
  };
};

/**
 * mount module function
 */
export const mountModule = async (targetModule: StarkModule, targetNode: HTMLElement, props: any = {}, sandbox?: ISandbox) => {
  const { mount, component } = await loadModule(targetModule, sandbox);
  return mount(component, targetNode, props);
};

/**
 * unmount module function
 */
export const unmoutModule = (targetModule: StarkModule, targetNode: HTMLElement) => {
  const { name } = targetModule;
  const moduleInfo = importModules[name]?.moduleInfo;
  const moduleSandbox = importModules[name]?.moduleSandbox;
  const unmount = targetModule.unmount || moduleInfo?.unmount || defaultUnmount;
  const cssList = filterRemoveCSS(importModules[name]?.moduleCSS);
  removeCSS(name, document, cssList);
  if (moduleSandbox?.clear) {
    moduleSandbox.clear();
  }

  return unmount(targetNode);
};

