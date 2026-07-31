import { useState, useEffect, useCallback, useRef, FormEvent } from 'react';
import axios from 'axios';
import { useAuth } from '@/context/AuthContext';
import { ModuleHeader } from '@/components/modules/shared';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MessagesSquare, Plus, Send, Trash2, Users, ShieldCheck, UserRound } from 'lucide-react';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

interface Conversation {
  id: string;
  type: 'equipe' | 'gestionnaires' | 'direct';
  name: string;
  participants: string[];
  last_message: string;
  last_sender: string;
  last_message_at: string;
  unread: number;
}

interface ChatMessage {
  id: string;
  sender_email: string;
  sender_name: string;
  sender_role: string;
  body: string;
  created_at: string;
}

interface ChatUser {
  email: string;
  name: string;
  role: string;
}

const TYPE_META = {
  equipe: { label: 'Toute l\'équipe', icon: Users, cls: 'bg-emerald-100 text-emerald-700' },
  gestionnaires: { label: 'Gestionnaires', icon: ShieldCheck, cls: 'bg-bronze-100 text-bronze-700' },
  direct: { label: 'Directe', icon: UserRound, cls: 'bg-sky-100 text-sky-700' },
} as const;

const timeLabel = (iso: string): string =>
  new Date(iso).toLocaleString('fr-CA', { dateStyle: 'short', timeStyle: 'short' });

export default function MessagesModule(): JSX.Element {
  const { currentUser, token } = useAuth();
  const headers = { Authorization: `Bearer ${token ?? ''}` };
  const isManager = currentUser?.role === 'admin' || currentUser?.role === 'manager' || currentUser?.role === 'superadmin';
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newType, setNewType] = useState<'equipe' | 'gestionnaires' | 'direct'>('equipe');
  const [newTarget, setNewTarget] = useState('');
  const [chatUsers, setChatUsers] = useState<ChatUser[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  const refreshConversations = useCallback(async (): Promise<void> => {
    try {
      const res = await axios.get<Conversation[]>(`${API}/chat/conversations`, { headers: { Authorization: `Bearer ${token ?? ''}` } });
      setConversations(res.data);
    } catch {
      setConversations([]);
    } finally {
      setLoaded(true);
    }
  }, [token]);

  const refreshMessages = useCallback(async (cid: string): Promise<void> => {
    try {
      const res = await axios.get<ChatMessage[]>(`${API}/chat/conversations/${cid}/messages`, { headers: { Authorization: `Bearer ${token ?? ''}` } });
      setMessages((prev) => (prev.length === res.data.length && prev[prev.length - 1]?.id === res.data[res.data.length - 1]?.id ? prev : res.data));
    } catch {
      setMessages([]);
    }
  }, [token]);

  useEffect(() => {
    void refreshConversations();
    const id = window.setInterval(() => void refreshConversations(), 10000);
    return () => window.clearInterval(id);
  }, [refreshConversations]);

  useEffect(() => {
    if (!activeId) return undefined;
    void refreshMessages(activeId);
    const id = window.setInterval(() => void refreshMessages(activeId), 4000);
    return () => window.clearInterval(id);
  }, [activeId, refreshMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  useEffect(() => {
    if (!createOpen || !isManager || !token) return;
    axios.get<ChatUser[]>(`${API}/chat/users`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => setChatUsers(r.data.filter((u) => u.email !== currentUser?.email)))
      .catch(() => setChatUsers([]));
  }, [createOpen, isManager, token, currentUser?.email]);

  const active = conversations.find((c) => c.id === activeId) ?? null;

  const openConversation = (cid: string): void => {
    setActiveId(cid);
    setMessages([]);
    setConversations((list) => list.map((c) => (c.id === cid ? { ...c, unread: 0 } : c)));
  };

  const createConversation = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    try {
      const res = await axios.post<Conversation>(`${API}/chat/conversations`, {
        type: newType,
        participant_email: newType === 'direct' ? newTarget : '',
      }, { headers });
      toast.success(`Conversation « ${res.data.name} » créée.`);
      setCreateOpen(false);
      setNewTarget('');
      await refreshConversations();
      openConversation(res.data.id);
    } catch (err) {
      const detail = axios.isAxiosError(err) && err.response ? (err.response.data as { detail?: unknown }).detail : null;
      toast.error(typeof detail === 'string' ? detail : 'Création impossible.');
    }
  };

  const sendMessage = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (!activeId || !draft.trim()) return;
    setSending(true);
    try {
      await axios.post(`${API}/chat/conversations/${activeId}/messages`, { body: draft.trim() }, { headers });
      setDraft('');
      await refreshMessages(activeId);
    } catch {
      toast.error('Envoi impossible.');
    } finally {
      setSending(false);
    }
  };

  const removeConversation = async (c: Conversation): Promise<void> => {
    try {
      await axios.delete(`${API}/chat/conversations/${c.id}`, { headers });
      toast.success(`Conversation « ${c.name} » supprimée.`);
      if (activeId === c.id) setActiveId(null);
      await refreshConversations();
    } catch {
      toast.error('Suppression impossible.');
    }
  };

  return (
    <div data-testid="messages-module">
      <ModuleHeader
        title="Messages"
        subtitle="Zone de communication entre propriétaires, gestionnaires et employés."
        action={isManager ? (
          <Button data-testid="new-conversation-button" onClick={() => setCreateOpen(true)} className="rounded-full bg-emerald-600 hover:bg-emerald-700">
            <Plus className="w-4 h-4 mr-1" /> Nouvelle conversation
          </Button>
        ) : undefined}
      />

      <div className="grid grid-cols-1 lg:grid-cols-[320px,1fr] gap-5" style={{ minHeight: '60vh' }}>
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden self-start">
          <p className="px-4 py-3 text-xs uppercase tracking-[0.15em] text-slate-500 font-semibold border-b border-slate-100">
            Conversations ({conversations.length})
          </p>
          {!loaded ? (
            <p className="p-4 text-sm text-slate-400">Chargement…</p>
          ) : conversations.length === 0 ? (
            <p data-testid="conversations-empty" className="p-4 text-sm text-slate-500">
              {isManager ? 'Aucune conversation — créez la première.' : 'Aucune conversation pour l\'instant. Votre gestionnaire peut en créer une.'}
            </p>
          ) : (
            <div className="divide-y divide-slate-100 max-h-[65vh] overflow-y-auto">
              {conversations.map((c) => {
                const meta = TYPE_META[c.type];
                const Icon = meta.icon;
                return (
                  <button
                    key={c.id}
                    data-testid={`conversation-item-${c.id}`}
                    onClick={() => openConversation(c.id)}
                    className={`w-full text-left px-4 py-3 transition-colors ${activeId === c.id ? 'bg-emerald-50' : 'hover:bg-slate-50'}`}
                  >
                    <div className="flex items-center gap-2.5">
                      <span className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${meta.cls}`}>
                        <Icon className="w-4 h-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-bold text-slate-800 truncate">{c.name}</p>
                          {c.unread > 0 && (
                            <span data-testid={`conversation-unread-${c.id}`} className="ml-auto shrink-0 min-w-5 h-5 px-1.5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                              {c.unread}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 truncate">
                          {c.last_message ? `${c.last_sender ? `${c.last_sender.split(' ')[0]} : ` : ''}${c.last_message}` : meta.label}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-slate-200 flex flex-col" data-testid="chat-thread">
          {!active ? (
            <div className="flex-1 flex flex-col items-center justify-center py-24 text-center px-6">
              <MessagesSquare className="w-10 h-10 text-slate-300 mb-3" />
              <p data-testid="chat-empty-state" className="text-sm text-slate-500">Choisissez une conversation pour commencer à discuter.</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-slate-100">
                <div>
                  <p className="text-sm font-bold text-slate-900">{active.name}</p>
                  <p className="text-xs text-slate-500">{TYPE_META[active.type].label}</p>
                </div>
                {isManager && (
                  <Button
                    data-testid={`delete-conversation-${active.id}`}
                    size="sm"
                    variant="outline"
                    onClick={() => void removeConversation(active)}
                    className="rounded-full text-xs text-red-600 border-red-200 hover:bg-red-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3" style={{ maxHeight: '52vh', minHeight: '40vh' }}>
                {messages.length === 0 && (
                  <p data-testid="thread-empty" className="text-sm text-slate-400 text-center py-10">Aucun message — écrivez le premier !</p>
                )}
                {messages.map((m) => {
                  const mine = m.sender_email === currentUser?.email;
                  return (
                    <div key={m.id} data-testid={`chat-message-${m.id}`} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${mine ? 'bg-emerald-600 text-white rounded-br-md' : 'bg-slate-100 text-slate-800 rounded-bl-md'}`}>
                        {!mine && (
                          <p className="text-[11px] font-bold mb-0.5 text-bronze-700">
                            {m.sender_name}
                            <span className="font-normal text-slate-400"> · {m.sender_role === 'admin' ? 'Propriétaire' : m.sender_role === 'manager' ? 'Gestionnaire' : 'Employé(e)'}</span>
                          </p>
                        )}
                        <p className="text-sm whitespace-pre-wrap break-words">{m.body}</p>
                        <p className={`text-[10px] mt-1 ${mine ? 'text-emerald-100' : 'text-slate-400'}`}>{timeLabel(m.created_at)}</p>
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>
              <form onSubmit={(e) => void sendMessage(e)} className="flex items-center gap-2 border-t border-slate-100 px-4 py-3">
                <Input
                  data-testid="chat-input"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Écrivez votre message…"
                  maxLength={2000}
                  className="flex-1"
                />
                <Button data-testid="chat-send-button" type="submit" disabled={sending || !draft.trim()} className="rounded-full bg-emerald-600 hover:bg-emerald-700 shrink-0">
                  <Send className="w-4 h-4" />
                </Button>
              </form>
            </>
          )}
        </div>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent data-testid="create-conversation-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading">Nouvelle conversation</DialogTitle>
            <DialogDescription>
              Toute l'équipe : visible par tous · Gestionnaires : réservée aux gestionnaires · Directe : avec un employé précis.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => void createConversation(e)} className="space-y-4">
            <div className="space-y-2">
              <Label>Type de conversation</Label>
              <Select value={newType} onValueChange={(v) => setNewType(v as typeof newType)}>
                <SelectTrigger data-testid="conversation-type-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="equipe">Toute l'équipe</SelectItem>
                  <SelectItem value="gestionnaires">Entre gestionnaires</SelectItem>
                  <SelectItem value="direct">Directe avec un employé</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {newType === 'direct' && (
              <div className="space-y-2">
                <Label>Employé / utilisateur</Label>
                <Select value={newTarget} onValueChange={setNewTarget}>
                  <SelectTrigger data-testid="conversation-user-select"><SelectValue placeholder="Choisir une personne" /></SelectTrigger>
                  <SelectContent>
                    {chatUsers.map((u) => (
                      <SelectItem key={u.email} value={u.email}>
                        {u.name} — {u.role === 'admin' ? 'Propriétaire' : u.role === 'manager' ? 'Gestionnaire' : 'Employé(e)'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <Button
              data-testid="create-conversation-submit"
              type="submit"
              disabled={newType === 'direct' && !newTarget}
              className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700"
            >
              Créer la conversation
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
