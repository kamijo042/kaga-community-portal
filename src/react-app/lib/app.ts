import { createContext, useContext, type ReactNode } from "react";

export type Tab = "info" | "jobs" | "market" | "chat" | "flow" | "home";

export type AppCtx = {
	tab: Tab;
	goTab: (t: Tab) => void;
	chatId: string | null;
	openChat: (tid: string) => void;
	closeChat: () => void;
	openModal: (node: ReactNode) => void;
	closeModal: () => void;
	toast: (msg: string) => void;
	/** 情報タブを開く前に最後に見た時刻（新着表示用） */
	infoPrev: number;
	/** 画面間の受け渡し（仕事・フリマのサブ画面） */
	jobMode: "browse" | "mine";
	setJobMode: (m: "browse" | "mine") => void;
	mktMode: "browse" | "mine";
	setMktMode: (m: "browse" | "mine") => void;
};

export const AppContext = createContext<AppCtx | null>(null);

export function useApp() {
	const v = useContext(AppContext);
	if (!v) throw new Error("AppContext がありません");
	return v;
}
