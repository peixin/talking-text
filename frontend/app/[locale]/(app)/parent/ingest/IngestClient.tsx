"use client";

import { useState, useRef } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { 
  Loader2, Upload, BookOpen, Bookmark, Trash2, Plus, 
  ArrowLeft, ArrowRight, Check, Image as ImageIcon, X
} from "lucide-react";
import { LearnerOut, LanguageItemIn, CollectionOut, CurriculumLessonsOut } from "@/lib/backend";
import { extractContent, saveToLesson, saveToCollection, listCollections, listCurricula, getCurriculumLessons } from "./actions";
import { useRouter } from "@/i18n/routing";

type Step = "upload" | "extracting" | "review" | "save" | "done";

interface Props {
  learners: LearnerOut[];
}

export default function IngestClient({ learners }: Props) {
  const t = useTranslations("Ingestion");
  const router = useRouter();

  const [step, setStep] = useState<Step>("upload");
  const [images, setImages] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [description, setDescription] = useState("");
  
  const [extractedItems, setExtractedItems] = useState<LanguageItemIn[]>([]);
  const [extractionNotes, setExtractionNotes] = useState<string | null>(null);

  const [saveTarget, setSaveTarget] = useState<"book" | "collection">("book");
  const [selectedLearner, setSelectedLearner] = useState<string>(learners[0]?.id || "");
  const [collections, setCollections] = useState<CollectionOut[]>([]);
  
  // Book fields
  const [curricula, setCurricula] = useState<{ id: string; name: string }[]>([]);
  const [selectedCurriculumId, setSelectedCurriculumId] = useState<string>("");
  const [bookName, setBookName] = useState("");
  
  const [curriculumData, setCurriculumData] = useState<CurriculumLessonsOut | null>(null);
  const [selectedUnitId, setSelectedUnitId] = useState<string>("");
  const [unitNumber, setUnitNumber] = useState("");

  const [selectedLessonId, setSelectedLessonId] = useState<string>("");
  const [lessonTitle, setLessonTitle] = useState("");

  // Collection fields
  const [selectedCollectionId, setSelectedCollectionId] = useState<string>("");
  const [newCollectionName, setNewCollectionName] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Step 1: Upload ───────────────────────────────────────────────────────────

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      setImages((prev) => [...prev, ...files]);
      files.forEach((file) => {
        const reader = new FileReader();
        reader.onloadend = () => setPreviews((prev) => [...prev, reader.result as string]);
        reader.readAsDataURL(file);
      });
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const startExtraction = async () => {
    if (images.length === 0 && !description.trim()) return;
    setStep("extracting");
    setError(null);

    const fd = new FormData();
    images.forEach(img => fd.append("images", img));
    fd.append("description", description);

    try {
      const result = await extractContent(fd);
      setExtractedItems(result.items);
      setExtractionNotes(result.notes);
      setStep("review");
    } catch (err: any) {
      setError(err.message || "Extraction failed");
      setStep("upload");
    }
  };

  // ── Step 2: Review ───────────────────────────────────────────────────────────

  const removeItem = (index: number) => {
    setExtractedItems((prev) => prev.filter((_, i) => i !== index));
  };

  const addItem = () => {
    setExtractedItems((prev) => [...prev, { text: "", type: "word" }]);
  };

  const updateItem = (index: number, field: keyof LanguageItemIn, value: string) => {
    setExtractedItems((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  // ── Step 3: Save ─────────────────────────────────────────────────────────────

  const goToSave = async () => {
    setStep("save");
    setLoading(true);
    try {
      if (selectedLearner) {
        const colls = await listCollections(selectedLearner);
        setCollections(colls);
      }
      const currs = await listCurricula();
      setCurricula(currs);
    } catch (err) {
      console.error("Failed to load save options", err);
    } finally {
      setLoading(false);
    }
  };

  const handleCurriculumSelect = async (id: string) => {
    setSelectedCurriculumId(id);
    setSelectedUnitId("");
    setSelectedLessonId("");
    setBookName("");
    setUnitNumber("");
    setLessonTitle("");
    if (!id || id === "new") {
      setCurriculumData(null);
      return;
    }
    const curr = curricula.find((c) => c.id === id);
    if (curr) setBookName(curr.name);
    
    setLoading(true);
    try {
      const data = await getCurriculumLessons(id);
      setCurriculumData(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleUnitSelect = (id: string) => {
    setSelectedUnitId(id);
    setSelectedLessonId("");
    setUnitNumber("");
    if (!id || id === "new") return;
    const unit = curriculumData?.units.find((u) => u.id === id);
    if (unit) setUnitNumber(unit.unit_number);
  };

  const handleLessonSelect = (id: string) => {
    setSelectedLessonId(id);
    setLessonTitle("");
    if (!id || id === "new") return;
    const unit = curriculumData?.units.find((u) => u.id === selectedUnitId);
    const lesson = unit?.lessons.find((l) => l.id === id);
    if (lesson) setLessonTitle(lesson.title || `Lesson ${lesson.sequence}`);
  };

  const handleSave = async () => {
    setLoading(true);
    setError(null);
    try {
      if (saveTarget === "book") {
        await saveToLesson({
          items: extractedItems,
          curriculum_name: bookName,
          unit_number: unitNumber,
          lesson_title: lessonTitle,
        });
      } else {
        await saveToCollection({
          items: extractedItems,
          learner_id: selectedLearner,
          collection_id: selectedCollectionId === "new" ? undefined : selectedCollectionId,
          new_collection_name: selectedCollectionId === "new" ? newCollectionName : undefined,
        });
      }
      setStep("done");
    } catch (err: any) {
      setError(err.message || "Save failed");
    } finally {
      setLoading(false);
    }
  };

  // ── Renders ──────────────────────────────────────────────────────────────────

  if (step === "done") {
    return (
      <Card className="mx-auto max-w-lg border-green-100 bg-green-50/30">
        <CardContent className="flex flex-col items-center py-12 text-center">
          <div className="mb-4 rounded-full bg-green-100 p-3 text-green-600">
            <Check className="h-8 w-8" />
          </div>
          <CardTitle className="mb-2 text-2xl">{t("save_success")}</CardTitle>
          <CardDescription className="mb-8">
            {saveTarget === "book" ? t("material_management_desc") : t("description")}
          </CardDescription>
          <div className="flex gap-4">
            <Button variant="outline" onClick={() => router.push("/parent")}>
              {t("back")}
            </Button>
            <Button onClick={() => router.push("/chat")}>
              {t("start_practice")}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 pb-20">
      <div className="mb-8 flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => {
          if (step === "save") setStep("review");
          else if (step === "review") setStep("upload");
          else router.back();
        }}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
      </div>

      {error && (
        <div className="mb-6 rounded-lg bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* STEP: UPLOAD */}
      {step === "upload" && (
        <Card>
          <CardHeader>
            <CardTitle>{t("upload_label")}</CardTitle>
            <CardDescription>{t("description")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              {previews.map((src, i) => (
                <div key={i} className="relative h-32 rounded-xl border p-2">
                  <img src={src} className="h-full w-full object-contain" />
                  <button 
                    onClick={(e) => { 
                      e.stopPropagation(); 
                      setImages(p => p.filter((_, idx) => idx !== i));
                      setPreviews(p => p.filter((_, idx) => idx !== i));
                    }}
                    className="absolute -right-2 -top-2 rounded-full bg-background p-1 shadow hover:text-destructive"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <div 
                onClick={() => fileInputRef.current?.click()}
                className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-muted-foreground/20 bg-muted/5 h-32 transition hover:border-primary/50 hover:bg-primary/5"
              >
                <Plus className="h-6 w-6 text-muted-foreground" />
                <span className="mt-2 text-xs text-muted-foreground">{t("upload_hint")}</span>
              </div>
              <input 
                ref={fileInputRef}
                type="file" 
                multiple
                accept="image/*" 
                className="hidden" 
                onChange={handleFileChange} 
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="desc">{t("desc_label")}</Label>
              <Textarea 
                id="desc"
                placeholder={t("desc_placeholder")}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="resize-none"
              />
            </div>
          </CardContent>
          <CardFooter>
            <Button 
              className="w-full" 
              disabled={images.length === 0 && !description.trim()} 
              onClick={startExtraction}
            >
              {t("next")}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </CardFooter>
        </Card>
      )}

      {/* STEP: EXTRACTING */}
      {step === "extracting" && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Loader2 className="mb-4 h-12 w-12 animate-spin text-primary" />
          <h2 className="text-xl font-medium">{t("extracting")}</h2>
          <p className="text-muted-foreground mt-2">Connecting to Doubao Vision...</p>
        </div>
      )}

      {/* STEP: REVIEW */}
      {step === "review" && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t("review_title")}</CardTitle>
              <CardDescription>{t("review_desc")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {extractedItems.map((item, idx) => (
                <div key={idx} className="flex items-start gap-3 rounded-lg border bg-card p-3 shadow-sm">
                  <div className="flex-1 space-y-3">
                    <div className="flex items-center gap-2">
                      <select 
                        value={item.type}
                        onChange={(e) => updateItem(idx, "type", e.target.value)}
                        className="rounded-md border border-input bg-background px-2 py-1 text-xs focus:ring-1 focus:ring-ring"
                      >
                        <option value="word">{t("words")}</option>
                        <option value="phrase">{t("phrases")}</option>
                        <option value="pattern">{t("patterns")}</option>
                      </select>
                      <Input 
                        value={item.text}
                        onChange={(e) => updateItem(idx, "text", e.target.value)}
                        className="h-8 border-none bg-muted/50 focus-visible:ring-0"
                        placeholder="Text..."
                      />
                    </div>
                    {item.type === "pattern" && (
                      <div className="flex items-center gap-2 pl-2">
                        <Label className="text-[10px] text-muted-foreground uppercase">Anchor</Label>
                        <Input 
                          value={item.anchor || ""}
                          onChange={(e) => updateItem(idx, "anchor", e.target.value)}
                          className="h-6 border-none bg-muted/30 text-xs focus-visible:ring-0"
                          placeholder="Fixed part (e.g. have you ever)"
                        />
                      </div>
                    )}
                  </div>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => removeItem(idx)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button variant="outline" className="w-full border-dashed" onClick={addItem}>
                <Plus className="mr-2 h-4 w-4" />
                {t("add_item")}
              </Button>
            </CardContent>
            <CardFooter>
              <Button className="w-full" onClick={goToSave}>
                {t("next")}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </CardFooter>
          </Card>
          {extractionNotes && (
             <div className="rounded-lg bg-muted/30 p-4 text-xs italic text-muted-foreground">
               {extractionNotes}
             </div>
          )}
        </div>
      )}

      {/* STEP: SAVE */}
      {step === "save" && (
        <Card>
          <CardHeader>
            <CardTitle>{t("save")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex gap-4">
              <button 
                onClick={() => setSaveTarget("book")}
                className={`flex flex-1 flex-col items-center gap-2 rounded-xl border p-4 transition ${saveTarget === "book" ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:bg-muted/50"}`}
              >
                <BookOpen className={`h-6 w-6 ${saveTarget === "book" ? "text-primary" : "text-muted-foreground"}`} />
                <span className="text-sm font-medium">{t("save_to_book")}</span>
              </button>
              <button 
                onClick={() => setSaveTarget("collection")}
                className={`flex flex-1 flex-col items-center gap-2 rounded-xl border p-4 transition ${saveTarget === "collection" ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:bg-muted/50"}`}
              >
                <Bookmark className={`h-6 w-6 ${saveTarget === "collection" ? "text-primary" : "text-muted-foreground"}`} />
                <span className="text-sm font-medium">{t("save_to_collection")}</span>
              </button>
            </div>

            <div className="space-y-4">
              {saveTarget === "book" ? (
                <>
                  <div className="space-y-2">
                    <Label>{t("book_name")}</Label>
                    <select 
                      value={selectedCurriculumId}
                      onChange={(e) => handleCurriculumSelect(e.target.value)}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm mb-2 focus:ring-1 focus:ring-ring"
                    >
                      <option value="">-- Select Book --</option>
                      {curricula.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      <option value="new">+ Create New Book</option>
                    </select>
                    {(selectedCurriculumId === "new" || !selectedCurriculumId) && (
                      <Input value={bookName} onChange={(e) => setBookName(e.target.value)} placeholder="New Concept English 1" />
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label>{t("unit_number")}</Label>
                    <select 
                      value={selectedUnitId}
                      onChange={(e) => handleUnitSelect(e.target.value)}
                      disabled={!selectedCurriculumId || selectedCurriculumId === "new"}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm mb-2 focus:ring-1 focus:ring-ring disabled:opacity-50"
                    >
                      <option value="">-- Select Unit --</option>
                      {curriculumData?.units.map(u => <option key={u.id} value={u.id}>{u.unit_number} - {u.title}</option>)}
                      <option value="new">+ Create New Unit</option>
                    </select>
                    {(selectedUnitId === "new" || !selectedCurriculumId || selectedCurriculumId === "new") && (
                      <Input value={unitNumber} onChange={(e) => setUnitNumber(e.target.value)} placeholder="1" />
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label>{t("lesson_title")}</Label>
                    <select 
                      value={selectedLessonId}
                      onChange={(e) => handleLessonSelect(e.target.value)}
                      disabled={!selectedUnitId || selectedUnitId === "new"}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm mb-2 focus:ring-1 focus:ring-ring disabled:opacity-50"
                    >
                      <option value="">-- Select Lesson --</option>
                      {curriculumData?.units.find(u => u.id === selectedUnitId)?.lessons.map(l => (
                        <option key={l.id} value={l.id}>{l.title || `Lesson ${l.sequence}`}</option>
                      ))}
                      <option value="new">+ Create New Lesson</option>
                    </select>
                    {(selectedLessonId === "new" || !selectedUnitId || selectedUnitId === "new") && (
                      <Input value={lessonTitle} onChange={(e) => setLessonTitle(e.target.value)} placeholder="Lesson 1" />
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label>{t("current_child")}</Label>
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
                  <div className="space-y-2">
                    <Label>{t("select_collection")}</Label>
                    <select 
                      value={selectedCollectionId}
                      onChange={(e) => setSelectedCollectionId(e.target.value)}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:ring-1 focus:ring-ring"
                    >
                      <option value="">{t("select_collection")}</option>
                      {collections.map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                      <option value="new">+ {t("new_collection")}</option>
                    </select>
                  </div>
                  {selectedCollectionId === "new" && (
                    <div className="space-y-2">
                      <Label>{t("collection_name")}</Label>
                      <Input value={newCollectionName} onChange={(e) => setNewCollectionName(e.target.value)} placeholder="My Daily Words" />
                    </div>
                  )}
                </>
              )}
            </div>
          </CardContent>
          <CardFooter>
            <Button 
              className="w-full" 
              disabled={loading || (saveTarget === "book" && !bookName) || (saveTarget === "collection" && !selectedCollectionId)} 
              onClick={handleSave}
            >
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
              {t("save")}
            </Button>
          </CardFooter>
        </Card>
      )}
    </div>
  );
}
