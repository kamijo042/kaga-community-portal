/** 線画アイコン（24×24、currentColor） */
type P = { size?: number };
const base = (size: number) => ({ width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true });

export const IconInfo = ({ size = 24 }: P) => (
	<svg {...base(size)}><path d="M4 10v4a1 1 0 0 0 1 1h2l5 4V5L7 9H5a1 1 0 0 0-1 1Z" /><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" /></svg>
);
export const IconJob = ({ size = 24 }: P) => (
	<svg {...base(size)}><rect x="3" y="7.5" width="18" height="12" rx="2.5" /><path d="M8.5 7.5V6a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v1.5M3 12.5h18" /></svg>
);
export const IconBag = ({ size = 24 }: P) => (
	<svg {...base(size)}><path d="M5 8h14l-1 12H6L5 8Z" /><path d="M9 8V6.5a3 3 0 0 1 6 0V8" /></svg>
);
export const IconChat = ({ size = 24 }: P) => (
	<svg {...base(size)}><path d="M20 12a7.5 7.5 0 0 1-11 6.6L4 20l1.4-4.5A7.5 7.5 0 1 1 20 12Z" /></svg>
);
export const IconStone = ({ size = 24 }: P) => (
	<svg {...base(size)}><path d="M4 14.5C4 9.5 8 6 12.5 6S20 8.8 20 13s-3.6 6-8 6-8-1.5-8-4.5Z" /><path d="M9 10.5c1-.8 2.2-1.2 3.5-1.2" /></svg>
);
export const IconHome = ({ size = 24 }: P) => (
	<svg {...base(size)}><path d="M4 11 12 4l8 7" /><path d="M6 9.5V20h12V9.5" /><path d="M10 20v-5h4v5" /></svg>
);
export const IconSearch = ({ size = 16 }: P) => (
	<svg {...base(size)} strokeWidth={2.4}><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>
);
export const IconMenu = ({ size = 16 }: P) => (
	<svg {...base(size)} strokeWidth={2}><path d="M4 7h16M4 12h16M4 17h16" /></svg>
);
