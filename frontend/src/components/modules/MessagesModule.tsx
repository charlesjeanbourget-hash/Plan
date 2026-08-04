import { useState, useEffect, useCallback, useRef, FormEvent } from 'react';
import axios from 'axios';
import { useAuth } from '@/context/AuthContext';
import { ModuleHeader } from '@/components/modules/shared';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MessagesSquare, Plus, Send, Trash2, Users, ShieldCheck, UserRound, Pin, PinOff, Paperclip, FileText, Download, X, Cake, PartyPopper, ClipboardList } from 'lucide-react';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

interface PinnedMessage {
  id: string;
  body: string;
  sender_name: string;
  created_at: string;
  attachment_name?: string;
}

interface Conversation {
  id: string;
  type: 'equipe' | 'gestionnaires' | 'direct';
  name: string;
  participants: string[];
  last_message: string;
  last_sender: string;
  last_message_at: string;
  unread: number;
  pinned_message?: PinnedMessage | null;
}

interface AttachmentMeta {
  id: string;
  name: string;
  mime: string;
  size: number;
}

interface ChatMessage {
  id: string;
  sender_email: string;
  sender_name: string;
  sender_role: string;
  body: string;
  created_at: string;
  kind?: string;
  attachment?: AttachmentMeta | null;
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

const MAX_FILE_BYTES = 5 * 1024 * 1024;

const timeLabel = (iso: string): string =>
  new Date(iso).toLocaleString('fr-CA', { dateStyle: 'short', timeStyle: 'short' });

const roleLabel = (role: string): string =>
  role === 'admin' ? 'Propriétaire' : role === 'manager' ? 'Gestionnaire' : role === 'system' ? 'Automatique' : 'Employé(e)';

const AttachmentView = ({ att, token, mine }: { att: AttachmentMeta; token: string; mine: boolean }): JSX.Element => {
  const [data, setData] = useState<string | null>(null);
  const isImage = att.mime.startsWith('image/');

  useEffect(() => {
    if (!isImage) return;
    axios.get<{ data: string }>(`${API}/chat/attachments/${att.id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => setData(r.data.data))
      .catch(() => undefined);
  }, [att.id, isImage, token]);

  const download = async (): Promise<void> => {
    let d = data;
    if (!d) {
      try {
        const r = await axios.get<{ data: string }>(`${API}/chat/attachments/${att.id}`, { headers: { Authorization: `Bearer ${token}` } });
        d = r.data.data;
      } catch {
        toast.error('Téléchargement impossible.');
        return;
      }
    }
    const a = document.createElement('a');
    a.href = d;
    a.download = att.name;
    a.click();
  };

  if (isImage) {
    return data ? (
      <img
        data-testid={`attachment-image-${att.id}`}
        src={data}
        alt={att.name}
        onClick={() => void download()}
        className="rounded-lg max-h-52 max-w-full cursor-pointer mb-1"
      />
    ) : (
      <div className="rounded-lg bg-black/10 w-40 h-24 animate-pulse mb-1" />
    );
  }
  return (
    <button
      type="button"
      data-testid={`attachment-file-${att.id}`}
      onClick={() => void download()}
      className={`flex items-center gap-2 rounded-lg px-3 py-2 mb-1 text-xs font-semibold border transition-colors ${mine ? 'bg-emerald-700/40 border-emerald-400/40 text-white hover:bg-emerald-700/60' : 'bg-white border-slate-200 text-slate-700 hover:border-emerald-300'}`}
    >
      <FileText className="w-4 h-4 shrink-0" />
      <span className="truncate max-w-44">{att.name}</span>
      <Download className="w-3.5 h-3.5 shrink-0 opacity-70" />
    </button>
  );
};

export default function MessagesModule(): JSX.Element {
  const { currentUser, token } = useAuth();
  const headers = { Authorization: `Bearer ${token ?? ''}` };
  const isManager = currentUser?.role === 'admin' || currentUser?.role === 'manager' || currentUser?.role === 'superadmin';
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newType, setNewType] = useState<'equipe' | 'gestionnaires' | 'direct'>('equipe');
  const [newTarget, setNewTarget] = useState('');
  const [chatUsers, setChatUsers] = useState<ChatUser[]>([]);
  const [birthdays, setBirthdays] = useState<{ employee_id: string; employee_name: string }[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!token) return;
    axios.get<{ employee_id: string; employee_name: string }[]>(`${API}/birthdays/today`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => setBirthdays(r.data))
      .catch(() => setBirthdays([]));
  }, [token]);

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
    setFile(null);
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

  const pickFile = (f: File | null): void => {
    if (!f) return;
    if (f.size > MAX_FILE_BYTES) {
      toast.error('Fichier trop volumineux (max 5 Mo).');
      return;
    }
    setFile(f);
  };

  const sendMessage = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (!activeId || (!draft.trim() && !file)) return;
    setSending(true);
    try {
      let attachment: { name: string; mime: string; data: string } | null = null;
      if (file) {
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error('read'));
          reader.readAsDataURL(file);
        });
        attachment = { name: file.name, mime: file.type || 'application/octet-stream', data };
      }
      await axios.post(`${API}/chat/conversations/${activeId}/messages`, { body: draft.trim(), attachment }, { headers });
      setDraft('');
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      await refreshMessages(activeId);
    } catch (err) {
      const detail = axios.isAxiosError(err) && err.response ? (err.response.data as { detail?: unknown }).detail : null;
      toast.error(typeof detail === 'string' ? detail : 'Envoi impossible.');
    } finally {
      setSending(false);
    }
  };

  const togglePin = async (messageId: string): Promise<void> => {
    try {
      const res = await axios.post<{ pinned: boolean }>(`${API}/chat/messages/${messageId}/pin`, {}, { headers });
      toast.success(res.data.pinned ? 'Message épinglé en haut de la conversation.' : 'Message désépinglé.');
      await refreshConversations();
    } catch {
      toast.error('Action impossible.');
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
                          {c.pinned_message && <Pin className="w-3 h-3 text-bronze-600 shrink-0" />}
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
              {active.type === 'equipe' && birthdays.length > 0 && (
                <div data-testid="birthday-banner" className="relative overflow-hidden flex items-center gap-3 px-5 py-3 border-b border-emerald-200 bg-gradient-to-r from-emerald-50 via-bronze-50 to-emerald-50">
                  <span className="w-9 h-9 rounded-full bg-emerald-600 text-white flex items-center justify-center shrink-0 animate-float-slow">
                    <Cake className="w-4.5 h-4.5" style={{ width: 18, height: 18 }} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-emerald-900">
                      {birthdays.length === 1
                        ? `C'est l'anniversaire de ${birthdays[0].employee_name} aujourd'hui !`
                        : `Anniversaires du jour : ${birthdays.map((b) => b.employee_name).join(', ')} !`}
                    </p>
                    <p className="text-xs text-emerald-700">Prenez un instant pour lui souhaiter une belle journée dans le clavardage.</p>
                  </div>
                  <PartyPopper className="w-5 h-5 text-bronze-600 shrink-0" />
                </div>
              )}
              {active.pinned_message && (
                <div data-testid="pinned-banner" className="flex items-start gap-2.5 px-5 py-2.5 bg-bronze-50 border-b border-bronze-200">
                  <Pin className="w-3.5 h-3.5 text-bronze-700 mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-bold text-bronze-800">Message épinglé · {active.pinned_message.sender_name}</p>
                    <p className="text-xs text-slate-700 truncate">
                      {active.pinned_message.body || (active.pinned_message.attachment_name ? `📎 ${active.pinned_message.attachment_name}` : '')}
                    </p>
                  </div>
                  {isManager && (
                    <button
                      data-testid="unpin-button"
                      onClick={() => void togglePin(active.pinned_message?.id ?? '')}
                      className="text-bronze-700 hover:text-bronze-900 shrink-0 mt-0.5"
                      aria-label="Désépingler"
                    >
                      <PinOff className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )}
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3" style={{ maxHeight: '48vh', minHeight: '36vh' }}>
                {messages.length === 0 && (
                  <p data-testid="thread-empty" className="text-sm text-slate-400 text-center py-10">Aucun message — écrivez le premier !</p>
                )}
                {messages.map((m) => {
                  if (m.kind === 'birthday' || m.kind === 'task_reminder') {
                    const festive = m.kind === 'birthday';
                    return (
                      <div key={m.id} data-testid={`${festive ? 'birthday' : 'task-reminder'}-message-${m.id}`} className="flex justify-center">
                        <div className={`max-w-[85%] rounded-2xl border px-5 py-3.5 text-center shadow-sm ${festive ? 'border-bronze-200 bg-gradient-to-r from-emerald-50 via-bronze-50 to-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
                          <p className={`text-[11px] font-bold inline-flex items-center gap-1.5 mb-1 ${festive ? 'text-bronze-700' : 'text-amber-700'}`}>
                            {festive ? <Cake className="w-3.5 h-3.5" /> : <ClipboardList className="w-3.5 h-3.5" />} Arrière Plan · message automatique
                          </p>
                          <p className="text-sm text-slate-800 whitespace-pre-wrap">{m.body}</p>
                          <p className="text-[10px] text-slate-400 mt-1">{timeLabel(m.created_at)}</p>
                        </div>
                      </div>
                    );
                  }
                  const mine = m.sender_email === currentUser?.email;
                  const pinned = active.pinned_message?.id === m.id;
                  return (
                    <div key={m.id} data-testid={`chat-message-${m.id}`} className={`group flex items-center gap-1.5 ${mine ? 'justify-end' : 'justify-start'}`}>
                      {mine && isManager && (
                        <button
                          data-testid={`pin-message-${m.id}`}
                          onClick={() => void togglePin(m.id)}
                          className={`transition-opacity ${pinned ? 'text-bronze-600 opacity-100' : 'text-slate-300 opacity-0 group-hover:opacity-100 hover:text-bronze-600'}`}
                          aria-label="Épingler"
                        >
                          <Pin className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${mine ? 'bg-emerald-600 text-white rounded-br-md' : 'bg-slate-100 text-slate-800 rounded-bl-md'} ${pinned ? 'ring-2 ring-bronze-300' : ''}`}>
                        {!mine && (
                          <p className="text-[11px] font-bold mb-0.5 text-bronze-700">
                            {m.sender_name}
                            <span className="font-normal text-slate-400"> · {roleLabel(m.sender_role)}</span>
                          </p>
                        )}
                        {m.attachment && <AttachmentView att={m.attachment} token={token ?? ''} mine={mine} />}
                        {m.body && <p className="text-sm whitespace-pre-wrap break-words">{m.body}</p>}
                        <p className={`text-[10px] mt-1 ${mine ? 'text-emerald-100' : 'text-slate-400'}`}>{timeLabel(m.created_at)}</p>
                      </div>
                      {!mine && isManager && (
                        <button
                          data-testid={`pin-message-${m.id}`}
                          onClick={() => void togglePin(m.id)}
                          className={`transition-opacity ${pinned ? 'text-bronze-600 opacity-100' : 'text-slate-300 opacity-0 group-hover:opacity-100 hover:text-bronze-600'}`}
                          aria-label="Épingler"
                        >
                          <Pin className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>
              {file && (
                <div data-testid="attachment-preview" className="flex items-center gap-2 px-4 pt-2">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 text-slate-700 text-xs font-semibold">
                    <Paperclip className="w-3 h-3" /> {file.name} ({(file.size / 1024).toFixed(0)} Ko)
                  </span>
                  <button data-testid="remove-attachment" onClick={() => { setFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }} className="text-slate-400 hover:text-red-600" aria-label="Retirer la pièce jointe">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              <form onSubmit={(e) => void sendMessage(e)} className="flex items-center gap-2 border-t border-slate-100 px-4 py-3">
                <input
                  ref={fileInputRef}
                  data-testid="attachment-input"
                  type="file"
                  accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
                  className="hidden"
                  onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
                />
                <Button
                  data-testid="attach-file-button"
                  type="button"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-full shrink-0 px-3"
                  aria-label="Joindre un fichier"
                >
                  <Paperclip className="w-4 h-4" />
                </Button>
                <Input
                  data-testid="chat-input"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Écrivez votre message…"
                  maxLength={2000}
                  className="flex-1"
                />
                <Button data-testid="chat-send-button" type="submit" disabled={sending || (!draft.trim() && !file)} className="rounded-full bg-emerald-600 hover:bg-emerald-700 shrink-0">
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
                        {u.name} — {roleLabel(u.role)}
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
