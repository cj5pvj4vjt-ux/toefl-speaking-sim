import React from 'react'

type P = { className?: string; size?: number }

const base = (size = 16) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const
})

export const IconHome = ({ className, size }: P): React.JSX.Element => (
  <svg {...base(size)} className={className}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V21h14V9.5" />
  </svg>
)

export const IconLibrary = ({ className, size }: P): React.JSX.Element => (
  <svg {...base(size)} className={className}>
    <path d="M4 4h6v16H4z" />
    <path d="M14 4h6v16h-6z" />
  </svg>
)

export const IconPlay = ({ className, size }: P): React.JSX.Element => (
  <svg {...base(size)} className={className}>
    <path d="M6 4.5 19 12 6 19.5z" />
  </svg>
)

export const IconHistory = ({ className, size }: P): React.JSX.Element => (
  <svg {...base(size)} className={className}>
    <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
    <path d="M3 4v4h4" />
    <path d="M12 7.5V12l3 2" />
  </svg>
)

export const IconSettings = ({ className, size }: P): React.JSX.Element => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2 2 2 0 1 1-4 0 1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15a2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.4-2.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 4.2a2 2 0 1 1 4 0 1.7 1.7 0 0 0 2.8 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 21 11a2 2 0 1 1 0 4z" />
  </svg>
)

export const IconUpload = ({ className, size }: P): React.JSX.Element => (
  <svg {...base(size)} className={className}>
    <path d="M12 16V4" />
    <path d="m7 9 5-5 5 5" />
    <path d="M4 17v2.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V17" />
  </svg>
)

export const IconMic = ({ className, size }: P): React.JSX.Element => (
  <svg {...base(size)} className={className}>
    <rect x="9" y="2.5" width="6" height="11" rx="3" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0" />
    <path d="M12 17.5V21" />
  </svg>
)

export const IconFile = ({ className, size }: P): React.JSX.Element => (
  <svg {...base(size)} className={className}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
  </svg>
)

export const IconCheck = ({ className, size }: P): React.JSX.Element => (
  <svg {...base(size)} className={className}>
    <path d="m4 12.5 5 5L20 6.5" />
  </svg>
)

export const IconAlert = ({ className, size }: P): React.JSX.Element => (
  <svg {...base(size)} className={className}>
    <path d="M12 3.5 2.5 20h19z" />
    <path d="M12 9.5v5" />
    <path d="M12 17.5h.01" />
  </svg>
)

export const IconDownload = ({ className, size }: P): React.JSX.Element => (
  <svg {...base(size)} className={className}>
    <path d="M12 3.5V16" />
    <path d="m7 11 5 5 5-5" />
    <path d="M4 20h16" />
  </svg>
)

export const IconTrash = ({ className, size }: P): React.JSX.Element => (
  <svg {...base(size)} className={className}>
    <path d="M4 7h16" />
    <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    <path d="M6 7l1 13h10l1-13" />
  </svg>
)

export const IconChevron = ({ className, size }: P): React.JSX.Element => (
  <svg {...base(size)} className={className}>
    <path d="m9 6 6 6-6 6" />
  </svg>
)

export const IconSpark = ({ className, size }: P): React.JSX.Element => (
  <svg {...base(size)} className={className}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" />
  </svg>
)

export const IconBack = ({ className, size }: P): React.JSX.Element => (
  <svg {...base(size)} className={className}>
    <path d="M15 6 9 12l6 6" />
  </svg>
)

export const IconRefresh = ({ className, size }: P): React.JSX.Element => (
  <svg {...base(size)} className={className}>
    <path d="M20 11a8 8 0 1 0-2.3 5.7" />
    <path d="M20 5v6h-6" />
  </svg>
)

export const IconEdit = ({ className, size }: P): React.JSX.Element => (
  <svg {...base(size)} className={className}>
    <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z" />
    <path d="M14.5 6.5 17.5 9.5" />
  </svg>
)

export const IconSearch = ({ className, size }: P): React.JSX.Element => (
  <svg {...base(size)} className={className}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5" />
  </svg>
)

export const IconKeyboard = ({ className, size }: P): React.JSX.Element => (
  <svg {...base(size)} className={className}>
    <rect x="2.5" y="6" width="19" height="12" rx="2" />
    <path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10" />
  </svg>
)
