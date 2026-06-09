import { tv } from 'tailwind-variants';

const widgetVariants = tv({
  slots: {
    base: 'widget',
    content: 'widget__content',
    description: 'widget__description',
    footer: 'widget__footer',
    header: 'widget__header',
    legend: 'widget__legend',
    legendItem: 'widget__legend-item',
    legendItemDot: 'widget__legend-item-dot',
    legendItemLabel: 'widget__legend-item-label',
    title: 'widget__title',
  },
});

export { widgetVariants };
