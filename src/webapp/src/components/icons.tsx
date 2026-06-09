import type { SVGProps } from 'react';
import { jsx, jsxs } from 'react/jsx-runtime';

type IconProps = SVGProps<SVGSVGElement>;

const base = (props: IconProps) => ({
  xmlns: 'http://www.w3.org/2000/svg',
  width: '16',
  height: '16',
  fill: 'none',
  viewBox: '0 0 16 16',
  ...props,
});

export const Bars = (props: IconProps) =>
  jsx('svg', {
    ...base(props),
    children: jsx('path', {
      fill: 'currentColor',
      fillRule: 'evenodd',
      d: 'M1.25 3.25A.75.75 0 0 1 2 2.5h12A.75.75 0 0 1 14 4H2a.75.75 0 0 1-.75-.75m0 4.75A.75.75 0 0 1 2 7.25h12a.75.75 0 0 1 0 1.5H2A.75.75 0 0 1 1.25 8M2 12a.75.75 0 0 0 0 1.5h12a.75.75 0 0 0 0-1.5z',
      clipRule: 'evenodd',
    }),
  });

export const ChevronLeft = (props: IconProps) =>
  jsx('svg', {
    ...base(props),
    children: jsx('path', {
      fill: 'currentColor',
      fillRule: 'evenodd',
      d: 'M10.53 2.97a.75.75 0 0 1 0 1.06L6.56 8l3.97 3.97a.75.75 0 1 1-1.06 1.06l-4.5-4.5a.75.75 0 0 1 0-1.06l4.5-4.5a.75.75 0 0 1 1.06 0',
      clipRule: 'evenodd',
    }),
  });

export const ChevronRight = (props: IconProps) =>
  jsx('svg', {
    ...base(props),
    children: jsx('path', {
      fill: 'currentColor',
      fillRule: 'evenodd',
      d: 'M5.47 13.03a.75.75 0 0 1 0-1.06L9.44 8 5.47 4.03a.75.75 0 0 1 1.06-1.06l4.5 4.5a.75.75 0 0 1 0 1.06l-4.5 4.5a.75.75 0 0 1-1.06 0',
      clipRule: 'evenodd',
    }),
  });

export const ChevronsExpandVertical = (props: IconProps) =>
  jsxs('svg', {
    ...base(props),
    children: [
      jsx('g', {
        clipPath: 'url(#a)',
        children: jsx('path', {
          fill: 'currentColor',
          fillRule: 'evenodd',
          d: 'M3.58 4.109a.75.75 0 0 0 1.061 1.06L8 1.811l3.354 3.353a.75.75 0 0 0 1.06-1.06L8.53.22a.75.75 0 0 0-1.06 0zm8.84 7.782a.75.75 0 1 0-1.061-1.06l-3.36 3.358-3.353-3.353a.75.75 0 1 0-1.06 1.06L7.47 15.78a.75.75 0 0 0 1.06 0z',
          clipRule: 'evenodd',
        }),
      }),
      jsx('defs', {
        children: jsx('clipPath', {
          id: 'a',
          children: jsx('path', { fill: 'currentColor', d: 'M0 0h16v16H0z' }),
        }),
      }),
    ],
  });

export const ChevronUp = (props: IconProps) =>
  jsx('svg', {
    ...base(props),
    children: jsx('path', {
      fill: 'currentColor',
      fillRule: 'evenodd',
      d: 'M13.03 10.53a.75.75 0 0 1-1.06 0L8 6.56l-3.97 3.97a.75.75 0 1 1-1.06-1.06l4.5-4.5a.75.75 0 0 1 1.06 0l4.5 4.5a.75.75 0 0 1 0 1.06',
      clipRule: 'evenodd',
    }),
  });

export const CloudArrowUpIn = (props: IconProps) =>
  jsxs('svg', {
    ...base(props),
    children: [
      jsx('g', {
        clipPath: 'url(#a)',
        children: jsx('path', {
          fill: 'currentColor',
          fillRule: 'evenodd',
          d: 'M4.5 5.25a3.25 3.25 0 0 1 6.398-.811.75.75 0 0 0 .702.563A3 3 0 0 1 11.5 11h-.75a.75.75 0 0 0 0 1.5h.75a4.5 4.5 0 0 0 .687-8.948 4.751 4.751 0 0 0-9.184 1.522A3.751 3.751 0 0 0 3.75 12.5h1.5a.75.75 0 0 0 0-1.5H3.751a2.25 2.25 0 0 1-.003-4.5h.03a.75.75 0 0 0 .747-.843A3 3 0 0 1 4.5 5.25m4.25 3.31.72.72a.75.75 0 1 0 1.06-1.06l-2-2a.75.75 0 0 0-1.06 0l-2 2a.75.75 0 0 0 1.06 1.06l.72-.72v6.69a.75.75 0 0 0 1.5 0z',
          clipRule: 'evenodd',
        }),
      }),
      jsx('defs', {
        children: jsx('clipPath', {
          id: 'a',
          children: jsx('path', { fill: 'currentColor', d: 'M0 0h16v16H0z' }),
        }),
      }),
    ],
  });

export const Grip = (props: IconProps) =>
  jsx('svg', {
    ...base(props),
    children: jsx('path', {
      fill: 'currentColor',
      fillRule: 'evenodd',
      d: 'M7 3a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0M5.5 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3m5 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3m0-5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3M7 13a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0m3.5 1.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3',
      clipRule: 'evenodd',
    }),
  });

export const GripHorizontal = (props: IconProps) =>
  jsx('svg', {
    ...base(props),
    children: jsx('path', {
      fill: 'currentColor',
      fillRule: 'evenodd',
      d: 'M3 9a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3m6.5 1.5a1.5 1.5 0 1 0-3 0 1.5 1.5 0 0 0 3 0m0-5a1.5 1.5 0 1 0-3 0 1.5 1.5 0 0 0 3 0m-5 0a1.5 1.5 0 1 0-3 0 1.5 1.5 0 0 0 3 0M13 9a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3m1.5-3.5a1.5 1.5 0 1 0-3 0 1.5 1.5 0 0 0 3 0',
      clipRule: 'evenodd',
    }),
  });

export const LayoutSideContentLeft = (props: IconProps) =>
  jsx('svg', {
    ...base(props),
    children: jsx('path', {
      fill: 'currentColor',
      fillRule: 'evenodd',
      d: 'M6 3.5h6A1.5 1.5 0 0 1 13.5 5v6a1.5 1.5 0 0 1-1.5 1.5H6zm-1.5 0H4A1.5 1.5 0 0 0 2.5 5v6A1.5 1.5 0 0 0 4 12.5h.5zM1 5a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H4a3 3 0 0 1-3-3z',
      clipRule: 'evenodd',
    }),
  });

export const LayoutSideContentRight = (props: IconProps) =>
  jsx('svg', {
    ...base(props),
    children: jsx('path', {
      fill: 'currentColor',
      fillRule: 'evenodd',
      d: 'M10 3.5H4A1.5 1.5 0 0 0 2.5 5v6A1.5 1.5 0 0 0 4 12.5h6zm1.5 0h.5A1.5 1.5 0 0 1 13.5 5v6a1.5 1.5 0 0 1-1.5 1.5h-.5zM15 5a3 3 0 0 0-3-3H4a3 3 0 0 0-3 3v6a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3z',
      clipRule: 'evenodd',
    }),
  });

export const Minus = (props: IconProps) =>
  jsx('svg', {
    ...base(props),
    children: jsx('path', {
      fill: 'currentColor',
      fillRule: 'evenodd',
      d: 'M1.75 8a.75.75 0 0 1 .75-.75h11a.75.75 0 0 1 0 1.5h-11A.75.75 0 0 1 1.75 8',
      clipRule: 'evenodd',
    }),
  });

export const Plus = (props: IconProps) =>
  jsx('svg', {
    ...base(props),
    children: jsx('path', {
      fill: 'currentColor',
      fillRule: 'evenodd',
      d: 'M8 1.75a.75.75 0 0 1 .75.75v4.75h4.75a.75.75 0 0 1 0 1.5H8.75v4.75a.75.75 0 0 1-1.5 0V8.75H2.5a.75.75 0 0 1 0-1.5h4.75V2.5A.75.75 0 0 1 8 1.75',
      clipRule: 'evenodd',
    }),
  });

export const TrashBin = (props: IconProps) =>
  jsx('svg', {
    ...base(props),
    children: jsx('path', {
      fill: 'currentColor',
      fillRule: 'evenodd',
      d: 'M9 2H7a.5.5 0 0 0-.5.5V3h3v-.5A.5.5 0 0 0 9 2m2 1v-.5a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2V3H2.251a.75.75 0 0 0 0 1.5h.312l.317 7.625A3 3 0 0 0 5.878 15h4.245a3 3 0 0 0 2.997-2.875l.318-7.625h.312a.75.75 0 0 0 0-1.5zm.936 1.5H4.064l.315 7.562A1.5 1.5 0 0 0 5.878 13.5h4.245a1.5 1.5 0 0 0 1.498-1.438zm-6.186 2v5a.75.75 0 0 0 1.5 0v-5a.75.75 0 0 0-1.5 0m3.75-.75a.75.75 0 0 1 .75.75v5a.75.75 0 0 1-1.5 0v-5a.75.75 0 0 1 .75-.75',
      clipRule: 'evenodd',
    }),
  });

export const ArrowUp = (props: IconProps) =>
  jsx('svg', {
    ...base(props),
    children: jsx('path', {
      fill: 'currentColor',
      fillRule: 'evenodd',
      d: 'M8 14.75a.75.75 0 0 1-.75-.75V3.81L4.53 6.53a.75.75 0 0 1-1.06-1.06l4-4a.75.75 0 0 1 1.06 0l4 4a.75.75 0 0 1-1.06 1.06L8.75 3.81V14a.75.75 0 0 1-.75.75',
      clipRule: 'evenodd',
    }),
  });

export const ArrowsRotateLeft = (props: IconProps) =>
  jsx('svg', {
    ...base(props),
    children: jsx('path', {
      fill: 'currentColor',
      fillRule: 'evenodd',
      d: 'M8 1.5a6.5 6.5 0 0 1 6.445 5.649.75.75 0 1 1-1.488.194A5.001 5.001 0 0 0 4.43 4.5h1.32a.75.75 0 0 1 0 1.5h-3A.75.75 0 0 1 2 5.25v-3a.75.75 0 1 1 1.5 0v1.06A6.48 6.48 0 0 1 8 1.5m5.25 13a.75.75 0 0 0 .75-.75v-3a.75.75 0 0 0-.75-.75h-3a.75.75 0 1 0 0 1.5h1.32a5.001 5.001 0 0 1-8.528-2.843.75.75 0 1 0-1.487.194 6.501 6.501 0 0 0 10.945 3.84v1.059c0 .414.336.75.75.75',
      clipRule: 'evenodd',
    }),
  });

export const Check = (props: IconProps) =>
  jsx('svg', {
    ...base(props),
    children: jsx('path', {
      fill: 'currentColor',
      fillRule: 'evenodd',
      d: 'M13.488 3.43a.75.75 0 0 1 .081 1.058l-6 7a.75.75 0 0 1-1.1.042l-3.5-3.5A.75.75 0 0 1 4.03 6.97l2.928 2.927 5.473-6.385a.75.75 0 0 1 1.057-.081',
      clipRule: 'evenodd',
    }),
  });

export const ChevronDown = (props: IconProps) =>
  jsx('svg', {
    ...base(props),
    children: jsx('path', {
      fill: 'currentColor',
      fillRule: 'evenodd',
      d: 'M2.97 5.47a.75.75 0 0 1 1.06 0L8 9.44l3.97-3.97a.75.75 0 1 1 1.06 1.06l-4.5 4.5a.75.75 0 0 1-1.06 0l-4.5-4.5a.75.75 0 0 1 0-1.06',
      clipRule: 'evenodd',
    }),
  });

export const CircleCheck = (props: IconProps) =>
  jsx('svg', {
    ...base(props),
    children: jsx('path', {
      fill: 'currentColor',
      fillRule: 'evenodd',
      d: 'M13.5 8a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0M15 8A7 7 0 1 1 1 8a7 7 0 0 1 14 0m-3.9-1.55a.75.75 0 1 0-1.2-.9L7.419 8.858 6.03 7.47a.75.75 0 0 0-1.06 1.06l2 2a.75.75 0 0 0 1.13-.08z',
      clipRule: 'evenodd',
    }),
  });

export const CircleExclamation = (props: IconProps) =>
  jsx('svg', {
    ...base(props),
    children: jsx('path', {
      fill: 'currentColor',
      fillRule: 'evenodd',
      d: 'M8 13.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14m1-4.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0M8.75 5a.75.75 0 0 0-1.5 0v2.5a.75.75 0 0 0 1.5 0z',
      clipRule: 'evenodd',
    }),
  });

export const CircleXmark = (props: IconProps) =>
  jsx('svg', {
    ...base(props),
    children: jsx('path', {
      fill: 'currentColor',
      fillRule: 'evenodd',
      d: 'M13.5 8a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0M15 8A7 7 0 1 1 1 8a7 7 0 0 1 14 0M6.53 5.47a.75.75 0 0 0-1.06 1.06L6.94 8 5.47 9.47a.75.75 0 1 0 1.06 1.06L8 9.06l1.47 1.47a.75.75 0 1 0 1.06-1.06L9.06 8l1.47-1.47a.75.75 0 1 0-1.06-1.06L8 6.94z',
      clipRule: 'evenodd',
    }),
  });

export const Copy = (props: IconProps) =>
  jsx('svg', {
    ...base(props),
    children: jsx('path', {
      fill: 'currentColor',
      fillRule: 'evenodd',
      d: 'M12 2.5H8A1.5 1.5 0 0 0 6.5 4v1H8a3 3 0 0 1 3 3v1.5h1A1.5 1.5 0 0 0 13.5 8V4A1.5 1.5 0 0 0 12 2.5M11 11h1a3 3 0 0 0 3-3V4a3 3 0 0 0-3-3H8a3 3 0 0 0-3 3v1H4a3 3 0 0 0-3 3v4a3 3 0 0 0 3 3h4a3 3 0 0 0 3-3zM4 6.5h4A1.5 1.5 0 0 1 9.5 8v4A1.5 1.5 0 0 1 8 13.5H4A1.5 1.5 0 0 1 2.5 12V8A1.5 1.5 0 0 1 4 6.5',
      clipRule: 'evenodd',
    }),
  });

export const Ellipsis = (props: IconProps) =>
  jsx('svg', {
    ...base(props),
    children: jsx('path', {
      fill: 'currentColor',
      fillRule: 'evenodd',
      d: 'M3 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3M9.5 8a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0m5 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0',
      clipRule: 'evenodd',
    }),
  });

export const FileText = (props: IconProps) =>
  jsx('svg', {
    ...base(props),
    children: jsx('path', {
      fill: 'currentColor',
      fillRule: 'evenodd',
      d: 'M5 13.5h6a1.5 1.5 0 0 0 1.5-1.5V7.243a1.5 1.5 0 0 0-.44-1.061L8.819 2.939a1.5 1.5 0 0 0-1.06-.439H5A1.5 1.5 0 0 0 3.5 4v8A1.5 1.5 0 0 0 5 13.5m9-6.257a3 3 0 0 0-.879-2.122L9.88 1.88A3 3 0 0 0 7.757 1H5a3 3 0 0 0-3 3v8a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3zM5 8.25a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5A.75.75 0 0 1 5 8.25m.75 2.25a.75.75 0 0 0 0 1.5h2.5a.75.75 0 0 0 0-1.5z',
      clipRule: 'evenodd',
    }),
  });

export const ThumbsDown = (props: IconProps) =>
  jsx('svg', {
    ...base(props),
    children: jsx('path', {
      fill: 'currentColor',
      fillRule: 'evenodd',
      d: 'm12 9-2.94 5.041a1.932 1.932 0 0 1-3.56-1.378l.25-1.163.321-1.5h-2.94a2 2 0 0 1-1.927-2.535l.879-3.162A4 4 0 0 1 6.404 1.4L11.5 2zM6.229 2.89l3.863.455.379 5.3-2.708 4.64a.432.432 0 0 1-.796-.308l.571-2.663.389-1.814H3.13a.5.5 0 0 1-.482-.634l.879-3.162a2.5 2.5 0 0 1 2.7-1.814m7.023 5.663a.75.75 0 1 0 1.496-.106l-.5-7a.75.75 0 0 0-1.496.106z',
      clipRule: 'evenodd',
    }),
  });

export const ThumbsUp = (props: IconProps) =>
  jsx('svg', {
    ...base(props),
    children: jsx('path', {
      fill: 'currentColor',
      fillRule: 'evenodd',
      d: 'm4 7 2.94-5.041a1.932 1.932 0 0 1 3.56 1.378L10.25 4.5 9.93 6h2.94a2 2 0 0 1 1.927 2.535l-.879 3.162A4 4 0 0 1 9.596 14.6L4.5 14zm5.771 6.11-3.863-.455-.379-5.3 2.708-4.64a.432.432 0 0 1 .796.308l-.571 2.663L8.073 7.5h4.796a.5.5 0 0 1 .482.634l-.879 3.162a2.5 2.5 0 0 1-2.7 1.814M2.748 7.447a.75.75 0 1 0-1.496.106l.5 7a.75.75 0 0 0 1.496-.106z',
      clipRule: 'evenodd',
    }),
  });

export const Wrench = (props: IconProps) =>
  jsx('svg', {
    ...base(props),
    children: jsx('path', {
      fill: 'currentColor',
      fillRule: 'evenodd',
      d: 'm8.581 9.298.776.143q.311.059.643.059A3.5 3.5 0 0 0 13.5 6q0-.177-.027-.352l-1.39 1.39a1.58 1.58 0 0 1-1.114.462A2.47 2.47 0 0 1 8.5 5.03c0-.417.166-.817.461-1.112l1.39-1.39A2.4 2.4 0 0 0 10 2.5a3.5 3.5 0 0 0-3.441 4.143l.143.776-3.813 3.813a1.329 1.329 0 0 0 1.879 1.879zm3.817-6.787a.795.795 0 0 0-.411-1.018C11.87 1.432 11.014 1 10 1a5 5 0 0 0-4.916 5.916l-3.256 3.256a2.828 2.828 0 1 0 4 4l3.256-3.256Q9.53 11 10 11a5 5 0 0 0 5-5c0-1.014-.432-1.87-.493-1.987l-.014-.027a.795.795 0 0 0-1.273-.207l-2.198 2.2a.07.07 0 0 1-.053.021.97.97 0 0 1-.969-.97q0-.03.022-.052L12.22 2.78a.8.8 0 0 0 .178-.27',
      clipRule: 'evenodd',
    }),
  });

export const Xmark = (props: IconProps) =>
  jsx('svg', {
    ...base(props),
    children: jsx('path', {
      fill: 'currentColor',
      fillRule: 'evenodd',
      d: 'M3.47 3.47a.75.75 0 0 1 1.06 0L8 6.94l3.47-3.47a.75.75 0 1 1 1.06 1.06L9.06 8l3.47 3.47a.75.75 0 1 1-1.06 1.06L8 9.06l-3.47 3.47a.75.75 0 0 1-1.06-1.06L6.94 8 3.47 4.53a.75.75 0 0 1 0-1.06',
      clipRule: 'evenodd',
    }),
  });
