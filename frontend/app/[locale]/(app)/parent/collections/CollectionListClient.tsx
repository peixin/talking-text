"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { LearnerOut, CollectionOut, CollectionItemOut } from "@/lib/backend";
import { getCollections, getCollectionItems, createChatSession } from "./actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2, Bookmark, FileText, MessageCircle } from "lucide-react";
import { useRouter } from "@/i18n/routing";

interface Props {
  learners: LearnerOut[];
}

export default function CollectionListClient({ learners }: Props) {
  const t = useTranslations("Collections");
  const router = useRouter();

  const [selectedLearner, setSelectedLearner] = useState<string>(learners[0]?.id || "");
  const [collections, setCollections] = useState<CollectionOut[]>([]);
  const [loading, setLoading] = useState(false);

  const [selectedCollection, setSelectedCollection] = useState<CollectionOut | null>(null);
  const [items, setItems] = useState<CollectionItemOut[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [startingChat, setStartingChat] = useState(false);

  useEffect(() => {
    if (!selectedLearner) return;
    let active = true;
    setLoading(true);
    getCollections(selectedLearner)
      .then((data) => {
        if (active) setCollections(data);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [selectedLearner]);

  useEffect(() => {
    if (!selectedCollection) return;
    let active = true;
    setLoadingItems(true);
    getCollectionItems(selectedCollection.id)
      .then((data) => {
        if (active) setItems(data);
      })
      .finally(() => {
        if (active) setLoadingItems(false);
      });
    return () => { active = false; };
  }, [selectedCollection]);

  if (learners.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8 text-center">
        <p className="text-muted-foreground">{t("no_children")}</p>
        <Button className="mt-4" onClick={() => router.push("/parent")}>{t("back")}</Button>
      </div>
    );
  }

  const handleStartChat = async () => {
    if (!selectedCollection || !selectedLearner) return;
    setStartingChat(true);
    try {
      const session = await createChatSession(selectedLearner, selectedCollection.id);
      router.push(`/chat/${session.id}`);
    } catch (e) {
      console.error(e);
      setStartingChat(false);
    }
  };

  if (selectedCollection) {
    return (
      <div className="mx-auto max-w-2xl px-4 pb-20">
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => setSelectedCollection(null)}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-semibold">{selectedCollection.name}</h1>
              <p className="text-sm text-muted-foreground">{selectedCollection.description || t("no_description")}</p>
            </div>
          </div>
          <Button onClick={handleStartChat} disabled={startingChat} className="gap-2">
            {startingChat ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
            Start Chat
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t("items_count", { count: items.length })}</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingItems ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : items.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">{t("empty_collection")}</p>
            ) : (
              <div className="space-y-3">
                {items.map((item) => (
                  <div key={item.id} className="flex items-start justify-between rounded-lg border bg-card p-3 shadow-sm">
                    <div>
                      <p className="font-medium">{item.text}</p>
                      {item.type === "pattern" && item.anchor && (
                        <p className="text-xs text-muted-foreground mt-1">Anchor: {item.anchor}</p>
                      )}
                    </div>
                    <Badge variant="outline">{t(`type_${item.type}` as any) || item.type}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 pb-20">
      <div className="mb-8 flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.push("/parent")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
      </div>

      <div className="mb-8 space-y-2">
        <label className="text-sm font-medium">{t("select_child")}</label>
        <select 
          value={selectedLearner}
          onChange={(e) => setSelectedLearner(e.target.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:ring-1 focus:ring-ring"
        >
          {learners.map(l => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
      </div>

      <div className="space-y-4">
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : collections.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
              <Bookmark className="mb-4 h-8 w-8 opacity-20" />
              <p>{t("no_collections")}</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {collections.map(c => (
              <Card 
                key={c.id} 
                className="cursor-pointer transition hover:border-primary/50 hover:bg-muted/5"
                onClick={() => setSelectedCollection(c)}
              >
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Bookmark className="h-4 w-4 text-primary" />
                    {c.name}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {c.description || t("no_description")}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
