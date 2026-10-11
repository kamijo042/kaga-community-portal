export const uid = (prefix: string) => prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export const fmt = (n: number | null | undefined) => Number(n || 0).toLocaleString("ja-JP");

export const WD = "日月火水木金土";

const HUES = ["#2E6A4E", "#7A4E2E", "#3C5A8A", "#8A3C5A", "#5A6E2A", "#2A6E6E", "#6A4E8A", "#8A6A2A"];
export function colorOf(id: string) {
	let h = 0;
	for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
	return HUES[h % HUES.length];
}

export function ago(t: number) {
	if (!t) return "";
	const s = (Date.now() - t) / 1000;
	if (s < 60) return "たった今";
	if (s < 3600) return Math.floor(s / 60) + "分前";
	if (s < 86400) return Math.floor(s / 3600) + "時間前";
	const d = new Date(t), n = new Date();
	return (d.getFullYear() !== n.getFullYear() ? d.getFullYear() + "/" : "") + (d.getMonth() + 1) + "/" + d.getDate();
}

export function clock(t: number) {
	const d = new Date(t);
	return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function todayStr(d = new Date()) {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function addDays(ds: string, n: number) {
	const d = new Date(ds + "T00:00");
	d.setDate(d.getDate() + n);
	return todayStr(d);
}

export function dayLabel(ds: string) {
	const d = new Date(ds + "T00:00");
	return `${d.getMonth() + 1}/${d.getDate()}（${WD[d.getDay()]}）`;
}

/** http / https 以外（javascript: など）はリンクにしない */
export function safeHttpUrl(v: string): string | null {
	try {
		const u = new URL(v);
		if ((u.protocol !== "http:" && u.protocol !== "https:") || u.username || u.password) return null;
		return u.href;
	} catch { return null; }
}

/** 0以上の整数か（空文字は false） */
export const isWhole = (v: string) => v.trim() !== "" && Number.isInteger(+v) && +v >= 0;

/** 画像を JPEG に縮小して data URL にする（だいたい 350KB 以下） */
export function compressImage(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const url = URL.createObjectURL(file);
		const img = new Image();
		img.onload = () => {
			let max = 1280, q = 0.82, out = "";
			for (let i = 0; i < 7; i++) {
				const sc = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
				const c = document.createElement("canvas");
				c.width = Math.round(img.naturalWidth * sc);
				c.height = Math.round(img.naturalHeight * sc);
				c.getContext("2d")?.drawImage(img, 0, 0, c.width, c.height);
				out = c.toDataURL("image/jpeg", q);
				if (out.length < 350_000) break;
				max *= 0.8;
				q = Math.max(0.5, q - 0.06);
			}
			URL.revokeObjectURL(url);
			resolve(out);
		};
		img.onerror = () => {
			URL.revokeObjectURL(url);
			reject(new Error("この画像形式は読み込めません（JPEG / PNG / WebP を選んでください）"));
		};
		img.src = url;
	});
}

/** プロフィール写真用：中央を正方形に切り抜いて 400px の JPEG にする */
export function squareAvatar(file: File, size = 400): Promise<string> {
	return new Promise((resolve, reject) => {
		const url = URL.createObjectURL(file);
		const img = new Image();
		img.onload = () => {
			const s = Math.min(img.naturalWidth, img.naturalHeight);
			const c = document.createElement("canvas");
			c.width = c.height = Math.min(size, s);
			c.getContext("2d")?.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, c.width, c.height);
			URL.revokeObjectURL(url);
			resolve(c.toDataURL("image/jpeg", 0.85));
		};
		img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("この画像形式は読み込めません（JPEG / PNG / WebP を選んでください）")); };
		img.src = url;
	});
}

export function downloadText(filename: string, text: string, type: string) {
	const a = document.createElement("a");
	a.href = URL.createObjectURL(new Blob([text], { type }));
	a.download = filename;
	a.click();
	setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** YYYY-MM-DD → 「10月20日（火）」 */
export function evDay(ds: string) {
	const d = new Date(ds + "T00:00");
	return isNaN(+d) ? ds : `${d.getMonth() + 1}月${d.getDate()}日（${WD[d.getDay()]}）`;
}
