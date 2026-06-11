import { buildResourceUrl } from '../../api/proxy';

export function resolveUrl(raw: string, baseUrl: string): string {
  if (!raw || raw.startsWith('data:') || raw.startsWith('blob:') || raw.startsWith('javascript:')) {
    return raw;
  }
  try {
    return new URL(raw, baseUrl).href;
  } catch {
    return raw;
  }
}

const CSS_URL_RE = /url\(\s*(['"]?)(.*?)\1\s*\)/g;

export function rewriteHtml(html: string, agentId: string, pageUrl: string, apiBase: string, token?: string | null): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  doc.head?.querySelectorAll('base').forEach(b => b.remove());

  const baseEl = doc.createElement('base');
  baseEl.href = pageUrl;
  if (doc.head) {
    if (doc.head.firstChild) {
      doc.head.insertBefore(baseEl, doc.head.firstChild);
    } else {
      doc.head.appendChild(baseEl);
    }
  }

  // Strip <meta http-equiv="refresh"> to prevent browser-level redirects
  doc.querySelectorAll('meta[http-equiv]').forEach(meta => {
    if (/refresh/i.test(meta.getAttribute('http-equiv') || '')) {
      meta.remove();
    }
  });

  doc.querySelectorAll('[src]').forEach(el => {
    rewriteAttr(el, 'src', agentId, pageUrl);
    if (el.hasAttribute('srcset')) {
      el.setAttribute('srcset', rewriteSrcset(el.getAttribute('srcset') || '', agentId, pageUrl));
    }
  });

  doc.querySelectorAll('source[srcset]').forEach(el => {
    el.setAttribute('srcset', rewriteSrcset(el.getAttribute('srcset') || '', agentId, pageUrl));
  });

  doc.querySelectorAll('link[href]').forEach(el => {
    const href = el.getAttribute('href') || '';
    const resolved = resolveUrl(href, pageUrl);
    if (resolved && !resolved.startsWith('data:') && !resolved.startsWith('javascript:')) {
      el.setAttribute('href', buildResourceUrl(agentId, resolved));
    }
  });

  doc.querySelectorAll('a[href]').forEach(a => {
    const href = a.getAttribute('href') || '';
    if (href.startsWith('javascript:') || href.startsWith('#')) return;
    const resolved = resolveUrl(href, pageUrl);
    a.setAttribute('data-proxy-href', resolved);
    a.setAttribute('href', 'javascript:void(0)');
  });

  doc.querySelectorAll('form[action]').forEach(form => {
    const action = form.getAttribute('action') || '';
    const resolved = resolveUrl(action, pageUrl);
    form.setAttribute('data-proxy-action', resolved);
  });

  doc.querySelectorAll('[poster]').forEach(el => {
    rewriteAttr(el, 'poster', agentId, pageUrl);
  });

  doc.querySelectorAll('style').forEach(style => {
    style.textContent = (style.textContent || '').replace(CSS_URL_RE, (_match, _quote, urlContent) => {
      const resolved = resolveUrl(urlContent, pageUrl);
      if (resolved && !resolved.startsWith('data:') && !resolved.startsWith('blob:')) {
        return `url(${buildResourceUrl(agentId, resolved)})`;
      }
      return `url(${urlContent})`;
    });
  });

  injectInterceptor(doc, agentId, token, pageUrl, apiBase);

  return new XMLSerializer().serializeToString(doc);
}

function rewriteAttr(el: Element, attr: string, agentId: string, baseUrl: string) {
  const raw = el.getAttribute(attr);
  if (!raw) return;
  const resolved = resolveUrl(raw, baseUrl);
  if (resolved && !resolved.startsWith('data:') && !resolved.startsWith('blob:') && !resolved.startsWith('javascript:')) {
    el.setAttribute(attr, buildResourceUrl(agentId, resolved));
  }
}

function rewriteSrcset(srcset: string, agentId: string, baseUrl: string): string {
  return srcset.replace(/(\S+)(\s+\d+[wx])?/g, (_match, url, desc) => {
    const resolved = resolveUrl(url, baseUrl);
    if (resolved && !resolved.startsWith('data:') && !resolved.startsWith('blob:')) {
      return buildResourceUrl(agentId, resolved) + (desc || '');
    }
    return url + (desc || '');
  });
}

function injectInterceptor(doc: Document, agentId: string, token?: string | null, pageUrl?: string, apiBase?: string) {
  const tokenParam = token ? `&token=${encodeURIComponent(token)}` : '';
  const safePageUrl = pageUrl ? JSON.stringify(pageUrl) : '""';
  const safeApiBase = apiBase ? JSON.stringify(apiBase) : 'window.location.origin+"/api"';
  const script = doc.createElement('script');
  script.textContent = [
  '(function(){',
  'var AGENT_ID='+JSON.stringify(agentId)+';',
  'var TOKEN_PARAM='+JSON.stringify(tokenParam)+';',
  'var PAGE_URL='+safePageUrl+';',
  'var API_BASE='+safeApiBase+';',
  'function proxyUrl(u,m,b,h){',
  '  var url=API_BASE+"/proxy/"+AGENT_ID+"/resource?url="+encodeURIComponent(u)+TOKEN_PARAM;',
  '  if(m)url+="&method="+encodeURIComponent(m);',
  '  if(b)url+="&body="+encodeURIComponent(b);',
  '  if(h)url+="&headers="+encodeURIComponent(h);',
  '  return url;',
  '}',
  'function resolveUrl(raw){',
  '  if(!raw||typeof raw!=="string")return raw;',
  '  if(/^(data|blob|javascript):/i.test(raw))return raw;',
  '  try{return String(new URL(raw,PAGE_URL));}catch(e){return raw;}',
  '}',
  'var _proxyNav=false;',
  'function nav(u,m,b,h){',
  '  _proxyNav=true;',
  '  window.parent.postMessage(JSON.stringify({type:"proxy-navigate",url:u,method:m||"GET",body:b||null,headers:h||null}),"*");',
  '}',
  '',
  '/* Lock window identity props */',
  'function lockProp(obj,prop,val){',
  '  try{Object.defineProperty(obj,prop,{get:function(){return val;},set:function(){},configurable:false});}catch(e){}',
  '}',
  'lockProp(window,"parent",window);',
  'lockProp(window,"top",window);',
  'lockProp(window,"opener",null);',
  '',
  '/* Intercept window.location = url (separate from Location.prototype.href) */',
  'try{',
  '  var _loc=window.location;',
  '  Object.defineProperty(window,"location",{',
  '    get:function(){return _loc;},',
  '    set:function(url){nav(resolveUrl(String(url)),"GET");},',
  '    configurable:true,enumerable:true',
  '  });',
  '}catch(_){}',
  '',
  '/* Intercept document.location = url */',
  'try{',
  '  Object.defineProperty(document,"location",{',
  '    get:function(){return window.location;},',
  '    set:function(url){nav(resolveUrl(String(url)),"GET");},',
  '    configurable:true,enumerable:true',
  '  });',
  '}catch(_){}',
  '',
  '/* Intercept Location.prototype.href / assign / replace */',
  '(function(){',
  '  var loc=window.location;',
  '  try{',
  '    var hd=Object.getOwnPropertyDescriptor(loc.constructor.prototype,"href");',
  '    if(hd){',
  '      Object.defineProperty(loc,"href",{',
  '        get:function(){return hd.get.call(loc);},',
  '        set:function(url){nav(resolveUrl(url),"GET");},',
  '        configurable:true',
  '      });',
  '    }',
  '  }catch(e){}',
  '  try{loc.constructor.prototype.assign=function(url){nav(resolveUrl(url),"GET");};}catch(e){}',
  '  try{loc.constructor.prototype.replace=function(url){nav(resolveUrl(url),"GET");};}catch(e){}',
  '})();',
  '',
  '/* Intercept history API */',
  'try{',
  '  history.pushState=function(s,t,u){if(u)nav(resolveUrl(u),"GET");};',
  '}catch(_){}',
  'try{',
  '  history.replaceState=function(s,t,u){if(u)nav(resolveUrl(u),"GET");};',
  '}catch(_){}',
  '',
  '/* Intercept <a> clicks */',
  'document.addEventListener("click",function(e){',
  '  var a=e.target.closest("a[data-proxy-href]");',
  '  if(!a)return;',
  '  e.preventDefault();e.stopPropagation();',
  '  nav(a.getAttribute("data-proxy-href"),"GET");',
  '},true);',
  '',
  '/* Intercept <form> submits */',
  'document.addEventListener("submit",function(e){',
  '  e.preventDefault();e.stopPropagation();',
  '  var f=e.target;',
  '  var action=f.getAttribute("data-proxy-action")||f.action;',
  '  if(!action)return;',
  '  var method=(f.method||"GET").toUpperCase();',
  '  try{',
  '    var fd=new FormData(f),p=new URLSearchParams();',
  '    fd.forEach(function(v,k){p.append(k,typeof v==="string"?v:"");});',
  '    nav(action+(action.indexOf("?")>=0?"&":"?")+p.toString(),method==="GET"?"GET":"POST",method==="GET"?null:p.toString());',
  '  }catch(_){nav(action,method);}',
  '},true);',
  '',
  '/* Proxy fetch() — pass method/body/headers */',
  'try{',
  '  var _fetch=window.fetch;',
  '  window.fetch=function(url,opts){',
  '    var o=opts||{};',
  '    var m=o.method||"GET";',
  '    return _fetch(proxyUrl(resolveUrl(url),m,o.body?String(o.body):null,o.headers?JSON.stringify(o.headers):null),o);',
  '  };',
  '}catch(_){}',
  '',
  '/* Proxy XMLHttpRequest.prototype.open — pass method/body */',
  'try{',
  '  var _open=XMLHttpRequest.prototype.open;',
  '  XMLHttpRequest.prototype.open=function(method,url,async,user,password){',
  '    return _open.call(this,method,proxyUrl(resolveUrl(url),method),async!==false,user,password);',
  '  };',
  '  var _send=XMLHttpRequest.prototype.send;',
  '  XMLHttpRequest.prototype.send=function(body){',
  '    return _send.call(this,body);',
  '  };',
  '}catch(_){}',
  '',
  '/* Intercept window.open */',
  'try{',
  '  window.open=function(url,target,features){',
  '    if(url&&!/^(javascript|data|blob):/i.test(url)){nav(resolveUrl(url),"GET");}',
  '    return null;',
  '  };',
  '}catch(_){}',
  '',
  '/* Shadow document.createElement — intercept both setAttribute AND property setters */',
  'try{',
  '  var _ce=document.createElement.bind(document);',
  '  document.createElement=function(tag,options){',
  '    var el=_ce(tag,options);',
  '    var tn=tag.toLowerCase();',
  '',
  '    /* Override setAttribute */',
  '    var _sa=el.setAttribute.bind(el);',
  '    el.setAttribute=function(name,value){',
  '      if(!value){_sa(name,value);return;}',
  '      var sv=String(value);',
  '      if(name==="href"&&tn==="a"&&!sv.startsWith("javascript:")&&!sv.startsWith("#")){',
  '        var r=resolveUrl(sv);_sa("data-proxy-href",r);_sa("href","javascript:void(0)");',
  '      }else if((name==="src"||name==="href"||name=="poster"||name=="srcset")&&!sv.startsWith("data:")&&!sv.startsWith("blob:")&&!sv.startsWith("javascript:")){',
  '        _sa(name,proxyUrl(resolveUrl(sv)));',
  '      }else if(name==="action"&&tn==="form"){',
  '        _sa("data-proxy-action",resolveUrl(sv));',
  '      }else{_sa(name,value);}',
  '    };',
  '',
  '    /* Intercept property setters (scripts do el.src = "...", el.href = "...") */',
  '    try{',
  '      if(tn==="script"||tn==="img"||tn==="iframe"||tn==="embed"||tn==="source"||tn==="video"||tn==="audio"||tn=="input"||tn=="track"){',
  '        var _srcDesc=Object.getOwnPropertyDescriptor(el.__proto__,"src")||Object.getOwnPropertyDescriptor(el.__proto__.__proto__,"src");',
  '        if(_srcDesc&&_srcDesc.set){',
  '          var _srcSet=_srcDesc.set.bind(el);',
  '          Object.defineProperty(el,"src",{get:function(){return el.getAttribute("src")||"";},set:function(v){',
  '            var sv=String(v);',
  '            if(sv&&!sv.startsWith("data:")&&!sv.startsWith("blob:")&&!sv.startsWith("javascript:")){',
  '              _sa("src",proxyUrl(resolveUrl(sv)));',
  '            }else{_sa("src",sv);}',
  '          },configurable:true,enumerable:true});',
  '        }',
  '      }',
  '      if(tn==="a"||tn==="link"){',
  '        var _hrefDesc=Object.getOwnPropertyDescriptor(el.__proto__,"href")||Object.getOwnPropertyDescriptor(el.__proto__.__proto__,"href");',
  '        if(_hrefDesc&&_hrefDesc.set){',
  '          var _hrefSet=_hrefDesc.set.bind(el);',
  '          var _hrefGet=_hrefDesc.get.bind(el);',
  '          Object.defineProperty(el,"href",{get:function(){return _hrefGet();},set:function(v){',
  '            var sv=String(v);',
  '            if(sv&&!sv.startsWith("javascript:")&&!sv.startsWith("#")&&tn==="a"){',
  '              _sa("data-proxy-href",resolveUrl(sv));',
  '              _sa("href","javascript:void(0)");',
  '            }else if(sv&&!sv.startsWith("data:")&&!sv.startsWith("javascript:")){',
  '              _sa("href",proxyUrl(resolveUrl(sv)));',
  '            }else{_sa("href",sv);}',
  '          },configurable:true,enumerable:true});',
  '        }',
  '      }',
  '      if(tn==="form"){',
  '        var _actionDesc=Object.getOwnPropertyDescriptor(el.__proto__,"action")||Object.getOwnPropertyDescriptor(el.__proto__.__proto__,"action");',
  '        if(_actionDesc&&_actionDesc.set){',
  '          var _actionSet=_actionDesc.set.bind(el);',
  '          Object.defineProperty(el,"action",{get:function(){return el.getAttribute("action")||"";},set:function(v){',
  '            var sv=String(v);',
  '            _sa("data-proxy-action",resolveUrl(sv));',
  '            _actionSet(sv);',
  '          },configurable:true,enumerable:true});',
  '        }',
  '      }',
  '    }catch(_){}',
  '',
  '    return el;',
  '  };',
  '}catch(_){}',
  '',
  '/* beforeunload — last-resort catch for unhandled navigation vectors */',
  'window.addEventListener("beforeunload",function(e){',
  '  if(_proxyNav){_proxyNav=false;return;}',
  '  nav(PAGE_URL,"GET");',
  '  e.preventDefault();',
  '  try{e.returnValue="";}catch(_){}',
  '});',
  '})();'
  ].join('\n');

  if (doc.head) {
    if (doc.head.firstChild) {
      doc.head.insertBefore(script, doc.head.firstChild);
    } else {
      doc.head.appendChild(script);
    }
  } else {
    const head = doc.createElement('head');
    head.appendChild(script);
    if (doc.documentElement?.firstChild) {
      doc.documentElement.insertBefore(head, doc.documentElement.firstChild);
    } else {
      doc.documentElement?.appendChild(head);
    }
  }
}
