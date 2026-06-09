import { CircleQuestion, House } from '@gravity-ui/icons';

export const siteConfig = {
  name: 'HeroUI Pro',
  description: 'Premium React component library for enterprise applications.',
};

export type PageKey = 'Home' | 'About' | 'Dashboard' | 'Agents';

export const pages: {
  icon: typeof House;
  id: PageKey;
  label: string;
  subtitle: string;
}[] = [
  {
    icon: House,
    id: 'Home',
    label: 'Home',
    subtitle: 'Dashboard overview',
  },
  {
    icon: CircleQuestion,
    id: 'About',
    label: 'About',
    subtitle: 'Project information and tech stack',
  },
];
