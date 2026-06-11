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

/**
 * Rewrite an HTML document so all resources load through the agent proxy.
 */
export function rewriteHtml(html: string, agentId: string, pageUrl: string, token?: string | null): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // Remove existing <base> tags, then inject our own.
  // This is critical: without <base>, srcdoc resolves relative URLs against
  // about:srcdoc, which falls back to the parent page origin (localhost:5173).
  doc.head?.querySelectorAll('base').forEach(b => b.remove());

  // Inject <base> as the FIRST element in <head> — before any scripts
  const baseEl = doc.createElement('base');
  baseEl.href = pageUrl;
  if (doc.head) {
    if (doc.head.firstChild) {
      doc.head.insertBefore(baseEl, doc.head.firstChild);
    } else {
      doc.head.appendChild(baseEl);
    }
  }

  // Rewrite src/srcset on media elements and scripts
  doc.querySelectorAll('[src]').forEach(el => {
    rewriteAttr(el, 'src', agentId, pageUrl);
    if (el.hasAttribute('srcset')) {
      el.setAttribute('srcset', rewriteSrcset(el.getAttribute('srcset') || '', agentId, pageUrl));
    }
  });

  doc.querySelectorAll('source[srcset]').forEach(el => {
    el.setAttribute('srcset', rewriteSrcset(el.getAttribute('srcset') || '', agentId, pageUrl));
  });

  // Rewrite link href (stylesheets, icons, etc.)
  doc.querySelectorAll('link[href]').forEach(el => {
    const href = el.getAttribute('href') || '';
    const resolved = resolveUrl(href, pageUrl);
    if (resolved && !resolved.startsWith('data:') && !resolved.startsWith('javascript:')) {
      el.setAttribute('href', buildResourceUrl(agentId, resolved));
    }
  });

  // Rewrite <a> href: save original, prevent direct navigation
  doc.querySelectorAll('a[href]').forEach(a => {
    const href = a.getAttribute('href') || '';
    if (href.startsWith('javascript:') || href.startsWith('#')) return;
    const resolved = resolveUrl(href, pageUrl);
    a.setAttribute('data-proxy-href', resolved);
    a.setAttribute('href', 'javascript:void(0)');
  });

  // Rewrite <form> action
  doc.querySelectorAll('form[action]').forEach(form => {
    const action = form.getAttribute('action') || '';
    const resolved = resolveUrl(action, pageUrl);
    form.setAttribute('data-proxy-action', resolved);
  });

  // Rewrite poster on <video>
  doc.querySelectorAll('[poster]').forEach(el => {
    rewriteAttr(el, 'poster', agentId, pageUrl);
  });

  // Rewrite url() in inline <style> tags
  doc.querySelectorAll('style').forEach(style => {
    style.textContent = (style.textContent || '').replace(CSS_URL_RE, (_match, _quote, urlContent) => {
      const resolved = resolveUrl(urlContent, pageUrl);
      if (resolved && !resolved.startsWith('data:') && !resolved.startsWith('blob:')) {
        return `url(${buildResourceUrl(agentId, resolved)})`;
      }
      return `url(${urlContent})`;
    });
  });

  // Inject comprehensive navigation + resource interception at the TOP of <head>
  // (before any page scripts run, so our intercepts take precedence)
  injectInterceptor(doc, agentId, token, pageUrl);

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

function injectInterceptor(doc: Document, agentId: string, token?: string | null, pageUrl?: string) {
  // Use JSON.stringify for safe escaping — prevents SyntaxError from special chars in URLs/tokens
  const tokenParam = token ? `&token=${encodeURIComponent(token)}` : '';
  const safePageUrl = pageUrl ? JSON.stringify(pageUrl) : '""';
  const script = doc.createElement('script');
  script.textContent = [
  '(function(){',
  'var AGENT_ID='+JSON.stringify(agentId)+';',
  'var TOKEN_PARAM='+JSON.stringify(tokenParam)+';',
  'var PAGE_URL='+safePageUrl+';',
  'var API_BASE='+JSON.stringify('http://127.0.0.1:5270/api')+';',
  'function proxyUrl(u){return API_BASE+"/proxy/"+AGENT_ID+"/resource?url="+encodeURIComponent(u)+TOKEN_PARAM;}',
  'function resolveUrl(raw){',
  '  if(!raw||typeof raw!=="string")return raw;',
  '  if(/^(data|blob|javascript):/i.test(raw))return raw;',
  '  try{return String(new URL(raw,PAGE_URL));}catch(e){return raw;}',
  '}',
  'function nav(u,m,b,h){',
  '  window.parent.postMessage(JSON.stringify({type:"proxy-navigate",url:u,method:m||"GET",body:b||null,headers:h||null}),"*");',
  '}',
  '',
  '/* Sandbox hardening */',
  'function lockProp(obj,prop,val){',
  '  try{Object.defineProperty(obj,prop,{get:function(){return val;},set:function(){},configurable:false});}catch(e){}',
  '}',
  'lockProp(window,"parent",window);',
  'lockProp(window,"top",window);',
  'lockProp(window,"opener",null);',
  'lockProp(window,"localStorage",null);',
  'lockProp(window,"sessionStorage",null);',
  'try{Object.defineProperty(document,"cookie",{get:function(){return"";},set:function(){},configurable:false});}catch(e){}',
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
  '/* Intercept location.href setter (most common JS navigation) */',
  '(function(){',
  '  var loc=window.location;',
  '  try{',
  '    var hd=Object.getOwnPropertyDescriptor(loc.constructor.prototype,"href");',
  '    Object.defineProperty(loc,"href",{',
  '      get:function(){return hd.get.call(loc);},',
  '      set:function(url){nav(resolveUrl(url),"GET");},',
  '      configurable:true',
  '    });',
  '  }catch(e){}',
  '  try{loc.constructor.prototype.assign=function(url){nav(resolveUrl(url),"GET");};}catch(e){}',
  '  try{loc.constructor.prototype.replace=function(url){nav(resolveUrl(url),"GET");};}catch(e){}',
  '})();',
  '',
  '/* Intercept history API */',
  'try{',
  '  var _ps=history.pushState;',
  '  history.pushState=function(s,t,u){if(u)nav(resolveUrl(u),"GET");};',
  '}catch(_){}',
  'try{',
  '  var _rs=history.replaceState;',
  '  history.replaceState=function(s,t,u){if(u)nav(resolveUrl(u),"GET");};',
  '}catch(_){}',
  '',
  '/* Proxy fetch() */',
  'try{',
  '  var _fetch=window.fetch;',
  '  window.fetch=function(url,opts){return _fetch(proxyUrl(resolveUrl(url)),opts||{});};',
  '}catch(_){}',
  '',
  '/* Proxy XMLHttpRequest.prototype.open (catches ALL XHR instances) */',
  'try{',
  '  var _open=XMLHttpRequest.prototype.open;',
  '  XMLHttpRequest.prototype.open=function(method,url,async,user,password){',
  '    return _open.call(this,method,proxyUrl(resolveUrl(url)),async!==false,user,password);',
  '  };',
  '}catch(_){}',
  '',
  '/* Intercept window.open */',
  'try{',
  '  var _wopen=window.open;',
  '  window.open=function(url,target,features){',
  '    if(url&&!/^(javascript|data|blob):/i.test(url)){nav(resolveUrl(url),"GET");}',
  '    return null;',
  '  };',
  '}catch(_){}',
  '',
  '/* Shadow document.createElement for dynamic resource creation */',
  'try{',
  '  var _ce=document.createElement.bind(document);',
  '  document.createElement=function(tag,options){',
  '    var el=_ce(tag,options);',
  '    var tn=tag.toLowerCase();',
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
  '    return el;',
  '  };',
  '}catch(_){}',
  '})();'
  ].join('\n');

  // Inject at the top of <head> so it runs before page scripts
  if (doc.head) {
    if (doc.head.firstChild) {
      doc.head.insertBefore(script, doc.head.firstChild);
    } else {
      doc.head.appendChild(script);
    }
  } else {
    // No <head> — create one
    const head = doc.createElement('head');
    head.appendChild(script);
    if (doc.documentElement?.firstChild) {
      doc.documentElement.insertBefore(head, doc.documentElement.firstChild);
    } else {
      doc.documentElement?.appendChild(head);
    }
  }
}
