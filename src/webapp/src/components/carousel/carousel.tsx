'use client';

import React, {
  type ComponentPropsWithRef,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Button as ButtonPrimitive } from 'react-aria-components/Button';
import { createPortal } from 'react-dom';
import type {
  EmblaCarouselType,
  EmblaOptionsType,
  EmblaPluginType,
} from 'embla-carousel';
import useEmblaCarousel from 'embla-carousel-react';
import { Button as HeroUIButton, ScrollShadow } from '@heroui/react';
import {
  composeSlotClassName,
  composeTwRenderProps,
} from '../../utils/compose';
import { ChevronLeft, ChevronRight } from '../icons';
import type { CarouselVariants } from './carousel.styles';
import { carouselVariants } from './carousel.styles';
import { CarouselContext } from './carousel-context';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CarouselRootProps extends ComponentPropsWithRef<'div'> {
  /** Embla Carousel options. */
  opts?: EmblaOptionsType;
  /** Embla Carousel plugins. */
  plugins?: EmblaPluginType[];
  /** Callback to receive the Embla API instance. */
  setApi?: (api: EmblaCarouselType) => void;
  /** Carousel type. @default "in-place" */
  type?: CarouselVariants['type'];
}

export interface CarouselContentProps extends ComponentPropsWithRef<'div'> {}
export interface CarouselItemProps extends ComponentPropsWithRef<'div'> {}

export interface CarouselPreviousProps extends ComponentPropsWithRef<
  typeof HeroUIButton
> {
  /** Custom icon to replace the default chevron. */
  icon?: ReactNode;
}

export interface CarouselNextProps extends ComponentPropsWithRef<
  typeof HeroUIButton
> {
  /** Custom icon to replace the default chevron. */
  icon?: ReactNode;
}

export interface CarouselDotsProps extends ComponentPropsWithRef<'div'> {
  /** Render function to customize each dot. */
  renderDot?: (props: { index: number; isSelected: boolean }) => ReactNode;
}

export interface CarouselThumbnailsProps extends ComponentPropsWithRef<'div'> {
  /** Hide the native scrollbar. @default true */
  hideScrollBar?: boolean;
  /** Size of the scroll shadow gradient in pixels. @default 40 */
  scrollShadowSize?: number;
}

export interface CarouselThumbnailProps extends ComponentPropsWithRef<
  typeof ButtonPrimitive
> {
  /** The slide index this thumbnail navigates to (0-based). */
  index: number;
  /** Alt text for the thumbnail image. */
  alt?: string;
  /** Image source URL. */
  src?: string;
}

// ─── Components ───────────────────────────────────────────────────────────────

export const CarouselRoot = ({
  children,
  className,
  opts,
  plugins,
  setApi,
  type = 'in-place',
  ...props
}: CarouselRootProps) => {
  const [emblaRef, emblaApi] = useEmblaCarousel(opts, plugins);
  const [viewportWrapper, setViewportWrapper] = useState<HTMLDivElement | null>(
    null
  );
  const [canScrollPrev, setCanScrollPrev] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [scrollSnapCount, setScrollSnapCount] = useState(0);

  const slots = useMemo(() => carouselVariants({ type }), [type]);

  const updateScrollState = useCallback((api: EmblaCarouselType) => {
    setCanScrollPrev(api.canScrollPrev());
    setCanScrollNext(api.canScrollNext());
    setSelectedIndex(api.selectedScrollSnap());
    setScrollSnapCount(api.scrollSnapList().length);
  }, []);

  const scrollPrev = useCallback(() => emblaApi?.scrollPrev(), [emblaApi]);
  const scrollNext = useCallback(() => emblaApi?.scrollNext(), [emblaApi]);
  const scrollTo = useCallback(
    (index: number) => emblaApi?.scrollTo(index),
    [emblaApi]
  );

  useEffect(() => {
    if (emblaApi && setApi) setApi(emblaApi);
  }, [emblaApi, setApi]);

  useEffect(() => {
    if (!emblaApi) return;
    updateScrollState(emblaApi);
    emblaApi.on('reInit', updateScrollState);
    emblaApi.on('select', updateScrollState);
    return () => {
      emblaApi.off('select', updateScrollState);
      emblaApi.off('reInit', updateScrollState);
    };
  }, [emblaApi, updateScrollState]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        scrollPrev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        scrollNext();
      }
    },
    [scrollPrev, scrollNext]
  );

  const contextValue = useMemo(
    () => ({
      api: emblaApi,
      canScrollNext,
      canScrollPrev,
      emblaRef,
      scrollNext,
      scrollPrev,
      scrollSnapCount,
      scrollTo,
      selectedIndex,
      setViewportWrapper,
      slots,
      type: (type ?? 'in-place') as 'in-place' | 'modal' | 'miniatures',
      viewportWrapper,
    }),
    [
      emblaApi,
      canScrollNext,
      canScrollPrev,
      emblaRef,
      scrollNext,
      scrollPrev,
      scrollSnapCount,
      scrollTo,
      selectedIndex,
      slots,
      type,
      viewportWrapper,
    ]
  );

  return (
    <CarouselContext.Provider value={contextValue}>
      <div
        aria-roledescription="carousel"
        className={composeSlotClassName(slots?.base, className)}
        data-slot="carousel"
        role="region"
        tabIndex={0}
        onKeyDownCapture={handleKeyDown}
        {...props}
      >
        {children}
      </div>
    </CarouselContext.Provider>
  );
};

export const CarouselContent = ({
  children,
  className,
  ...props
}: CarouselContentProps) => {
  const { emblaRef, setViewportWrapper, slots } = useContext(CarouselContext);
  return (
    <div
      ref={setViewportWrapper}
      className={slots?.viewportWrapper()}
      data-slot="carousel-viewport-wrapper"
    >
      <div
        ref={emblaRef}
        className={slots?.viewport()}
        data-slot="carousel-viewport"
      >
        <div
          className={composeSlotClassName(slots?.content, className)}
          data-slot="carousel-content"
          {...props}
        >
          {children}
        </div>
      </div>
    </div>
  );
};

export const CarouselItem = ({
  children,
  className,
  ...props
}: CarouselItemProps) => {
  const { slots } = useContext(CarouselContext);
  return (
    <div
      aria-roledescription="slide"
      className={composeSlotClassName(slots?.item, className)}
      data-slot="carousel-item"
      role="group"
      {...props}
    >
      {children}
    </div>
  );
};

export const CarouselPrevious = ({
  children,
  className,
  icon,
  ...props
}: CarouselPreviousProps) => {
  const { canScrollPrev, scrollPrev, slots, type, viewportWrapper } =
    useContext(CarouselContext);
  const button = (
    <HeroUIButton
      isIconOnly
      aria-label="Previous slide"
      className={composeTwRenderProps(className, slots?.previous())}
      data-slot="carousel-previous"
      isDisabled={!canScrollPrev}
      size="sm"
      variant="tertiary"
      onPress={scrollPrev}
      {...props}
    >
      {children ?? icon ?? <ChevronLeft />}
    </HeroUIButton>
  );

  if (type === 'miniatures') return button;
  return viewportWrapper ? createPortal(button, viewportWrapper) : null;
};

export const CarouselNext = ({
  children,
  className,
  icon,
  ...props
}: CarouselNextProps) => {
  const { canScrollNext, scrollNext, slots, type, viewportWrapper } =
    useContext(CarouselContext);
  const button = (
    <HeroUIButton
      isIconOnly
      aria-label="Next slide"
      className={composeTwRenderProps(className, slots?.next())}
      data-slot="carousel-next"
      isDisabled={!canScrollNext}
      size="sm"
      variant="tertiary"
      onPress={scrollNext}
      {...props}
    >
      {children ?? icon ?? <ChevronRight />}
    </HeroUIButton>
  );

  if (type === 'miniatures') return button;
  return viewportWrapper ? createPortal(button, viewportWrapper) : null;
};

export const CarouselDots = ({
  className,
  renderDot,
  ...props
}: CarouselDotsProps) => {
  const { scrollSnapCount, scrollTo, selectedIndex, slots } =
    useContext(CarouselContext);

  if (scrollSnapCount <= 1) return null;

  return (
    <div
      aria-label="Slide indicators"
      className={composeSlotClassName(slots?.dots, className)}
      data-slot="carousel-dots"
      role="tablist"
      {...props}
    >
      {Array.from({ length: scrollSnapCount }, (_, index) => {
        const isSelected = index === selectedIndex;
        return renderDot ? (
          <React.Fragment key={index}>
            {renderDot({ index, isSelected })}
          </React.Fragment>
        ) : (
          <ButtonPrimitive
            key={index}
            aria-label={`Go to slide ${index + 1}`}
            aria-selected={isSelected}
            className={composeTwRenderProps(undefined, slots?.dot())}
            data-selected={isSelected || undefined}
            data-slot="carousel-dot"
            onPress={() => scrollTo(index)}
          />
        );
      })}
    </div>
  );
};

export const CarouselThumbnails = ({
  children,
  className,
  hideScrollBar = true,
  scrollShadowSize = 40,
  ...props
}: CarouselThumbnailsProps) => {
  const { slots } = useContext(CarouselContext);
  return (
    <ScrollShadow
      aria-label="Slide thumbnails"
      className={composeSlotClassName(slots?.thumbnails, className)}
      data-slot="carousel-thumbnails"
      hideScrollBar={hideScrollBar}
      orientation="horizontal"
      role="tablist"
      size={scrollShadowSize}
      {...props}
    >
      {children}
    </ScrollShadow>
  );
};

export const CarouselThumbnail = ({
  alt = '',
  children,
  className,
  index,
  src,
  ...props
}: CarouselThumbnailProps) => {
  const { scrollTo, selectedIndex, slots } = useContext(CarouselContext);
  const isSelected = index === selectedIndex;

  return (
    <ButtonPrimitive
      aria-label={`Go to slide ${index + 1}`}
      aria-selected={isSelected}
      className={composeTwRenderProps(className, slots?.thumbnail())}
      data-selected={isSelected || undefined}
      data-slot="carousel-thumbnail"
      onPress={() => scrollTo(index)}
      {...props}
    >
      {children ?? (src ? <img alt={alt} draggable={false} src={src} /> : null)}
    </ButtonPrimitive>
  );
};
