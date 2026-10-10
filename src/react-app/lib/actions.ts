import { useCallback, useMemo } from "react";
import { useApp } from "./app";
import { threadId } from "./domain";
import { useData } from "./store";
import type { ItemStatus, State, ThreadKind } from "./types";
import { fmt, uid } from "./util";

/** 相談・成立記録など、複数のデータをまたぐ操作 */
export function useActions() {
	const { mutate, me, d } = useData();
	const { openChat, closeModal, toast } = useApp();

	const pushMsg = useCallback((s: State, tid: string, text: string, sys = false) => {
		const t = s.threads[tid];
		if (!t || !me) return;
		const m = { id: uid("m_"), from: me, t: Date.now(), text, sys };
		(s.messages[tid] ??= []).push(m);
		t.lastAt = m.t;
		t.lastBy = me;
		t.lastText = sys ? "【お知らせ】" + text : text;
		(s.reads[me] ??= {})[tid] = m.t;
	}, [me]);

	return useMemo(() => ({
		startThread(kind: ThreadKind, refId: string) {
			if (!me) return;
			const ref = kind === "job" ? d.jobs[refId] : kind === "item" ? d.items[refId] : d.posts[refId];
			if (!ref) return;
			if (ref.owner === me) { toast("自分の登録には相談できません"); return; }
			const id = threadId(kind, refId, me);
			if (!d.threads[id]) {
				const title = "title" in ref ? ref.title : ref.name;
				mutate((s) => {
					s.threads[id] = { id, kind, refId, owner: ref.owner, other: me, title, createdAt: Date.now(), lastAt: 0, lastBy: null, lastText: "" };
					s.messages[id] ??= [];
				});
			}
			closeModal();
			openChat(id);
		},
		send(tid: string, text: string) {
			mutate((s) => pushMsg(s, tid, text));
		},
		markRead(tid: string) {
			if (!me) return;
			const t = d.threads[tid];
			if (!t || (d.reads[me]?.[tid] ?? 0) >= (t.lastAt || 0)) return;
			mutate((s) => { (s.reads[me] ??= {})[tid] = Date.now(); });
		},
		setItemStatus(tid: string, status: ItemStatus) {
			const t = d.threads[tid];
			const i = t && d.items[t.refId];
			if (!t || !i || i.owner !== me) return;
			mutate((s) => {
				const it = s.items[i.id];
				if (it.status === "done" && status !== "done") {
					for (const e of Object.values(s.ledger)) if (e.kind === "item" && e.refId === it.id) delete s.ledger[e.id];
				}
				it.status = status;
				it.updatedAt = Date.now();
				delete it.buyer;
				delete it.doneAt;
				pushMsg(s, tid, status === "nego" ? `「${it.name}」を交渉中にしました。` : `「${it.name}」を出品中に戻しました（石の流通の記録も取り消しました）。`, true);
			});
		},
		/** 依頼成立（仕事）／交渉成立（フリマ）を石の流通に記録 */
		recordDeal(tid: string, amount: number, date: string) {
			const t = d.threads[tid];
			if (!t || !me || t.kind === "info") return;
			mutate((s) => {
				const e = { id: uid("l_"), date, at: Date.now(), kind: t.kind as "job" | "item", refId: t.refId, tid, from: t.other, to: t.owner, amount, title: t.title, by: me };
				s.ledger[e.id] = e;
				if (t.kind === "item") {
					const it = s.items[t.refId];
					if (it) { it.status = "done"; it.buyer = t.other; it.doneAt = Date.now(); it.updatedAt = Date.now(); }
					pushMsg(s, tid, `交渉成立しました（${fmt(amount)}石を流通に記録）。「${t.title}」の出品は終了です。受け渡しの日時と場所を確認しましょう。`, true);
				} else {
					pushMsg(s, tid, `依頼成立：${fmt(amount)}石（${date}）を石の流通に記録しました。`, true);
				}
			});
			toast("石の流通に記録しました");
		},
		undoDeal(tid: string, entryId: string) {
			const e = d.ledger[entryId];
			if (!e) return;
			mutate((s) => {
				delete s.ledger[entryId];
				pushMsg(s, tid, `${e.date} の成立記録（${fmt(e.amount)}石）を取り消しました。`, true);
			});
		},
	}), [d, me, mutate, pushMsg, openChat, closeModal, toast]);
}
