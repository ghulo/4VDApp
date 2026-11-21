// Tests read the words straight away: English is loaded and shown before each file starts.
import { en } from '../i18n/en';
import { registerCatalogue, setActiveLanguage } from '../i18n/useT';

registerCatalogue('en', en);
setActiveLanguage('en');
