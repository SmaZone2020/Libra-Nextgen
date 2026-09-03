import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en';
import zh from './locales/zh';

const stored = typeof window !== 'undefined' ? localStorage.getItem('lang') : null;
const defaultLang = stored || (typeof navigator !== 'undefined' && navigator.language.startsWith('zh') ? 'zh' : 'en');

i18n.use(initReactI18next).init({
  resources: { en, zh },
  lng: defaultLang,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export function switchLang(lang: 'en' | 'zh') {
  i18n.changeLanguage(lang);
  localStorage.setItem('lang', lang);
}

export { default as en } from './locales/en';
export { default as zh } from './locales/zh';
export default i18n;
