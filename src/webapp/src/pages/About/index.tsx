import { useEffect } from 'react';
import { motion, useSpring, useTransform } from 'motion/react';
import { Widget } from '@components/widget';
import { fadeUpItem, staggerContainer } from '../../shared/lib/animations';

function useAnimatedCounter(end: number, duration = 1.2) {
  const spring = useSpring(0, { duration: duration * 1000, bounce: 0.15 });
  const rounded = useTransform(spring, (v) => Math.round(v));

  useEffect(() => {
    spring.set(end);
  }, [end, spring]);

  return rounded;
}

function AnimatedCounter({ value, className }: { value: number; className?: string }) {
  const count = useAnimatedCounter(value);
  return <motion.span className={className}>{count}</motion.span>;
}

const techStack = [
  { category: 'Framework', items: ['React 19', 'TypeScript', 'Vite 6'] },
  { category: 'Styling', items: ['Tailwind CSS v4', 'tailwind-variants'] },
  { category: 'Accessibility', items: ['React Aria Components'] },
  { category: 'Animation', items: ['Motion'] },
  { category: 'Charts', items: ['Recharts'] },
  { category: 'Carousel', items: ['Embla Carousel'] },
];

export function AboutPage() {

  return (
    <motion.div
      animate="show"
      className="space-y-6"
      initial="hidden"
      variants={staggerContainer}
    >
      <motion.div>
        <Widget>
          <Widget.Header>
            <Widget.Title>About HeroUI Pro</Widget.Title>
          </Widget.Header>
          <Widget.Content>
            <p className="text-sm leading-6 text-neutral-600">
              HeroUI Pro is a premium React component library for enterprise
              applications, built on HeroUI v3 and Tailwind CSS v4. It ships 60+
              production-ready components covering data display, AI messaging,
              form inputs, layout, and surface patterns.
            </p>
          </Widget.Content>
        </Widget>
      </motion.div>

      <motion.div
        className="grid grid-cols-1 gap-3 sm:grid-cols-3"
        variants={staggerContainer}
      >
        {[
          { label: 'Components' },
          { label: 'Categories' },
          { label: 'Themes', value: 3 },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            className="border border-neutral-200 bg-white p-5 text-center"
            variants={{
              hidden: { opacity: 0, y: 20, scale: 0.95 },
              show: {
                opacity: 1,
                y: 0,
                scale: 1,
                transition: {
                  duration: 0.5,
                  delay: 0.05 + i * 0.1,
                  ease: [0.25, 0.46, 0.45, 0.94],
                },
              },
            }}
          >
            <AnimatedCounter
              className="text-3xl font-semibold text-blue-600"
              value={1}
            />
            <div className="mt-1 text-sm text-neutral-600">{stat.label}</div>
          </motion.div>
        ))}
      </motion.div>

      <motion.div>
        <Widget>
          <Widget.Header>
            <Widget.Title>Tech Stack</Widget.Title>
          </Widget.Header>
          <Widget.Content>
            <motion.div
              animate="show"
              className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
              initial="hidden"
              variants={staggerContainer}
            >
              {techStack.map((group) => (
                <motion.div key={group.category}>
                  <h4 className="mb-2 text-sm font-semibold text-neutral-900">
                    {group.category}
                  </h4>
                  <ul className="space-y-1">
                    {group.items.map((item) => (
                      <li key={item} className="text-sm text-neutral-600">
                        {item}
                      </li>
                    ))}
                  </ul>
                </motion.div>
              ))}
            </motion.div>
          </Widget.Content>
        </Widget>
      </motion.div>
    </motion.div>
  );
}
