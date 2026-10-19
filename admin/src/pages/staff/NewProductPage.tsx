import { Camera, Trash } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { CameraScanButton } from '../../components/CameraScanner';
import { Button, ButtonLink, Card, Field, PageHeader } from '../../components/ui';
import { useT } from '../../i18n/useT';
import { categoriesApi } from '../../services/api';
import { teamApi } from '../../services/teamApi';
import { errorMessage } from '../../utils/errors';
import { shrinkPhoto } from '../../utils/shrinkPhoto';

const NO_CATEGORY = 'none';

/** A photo as the base64 the API takes, after shrinking it for shop Wi-Fi. */
async function photoPayload(file: File): Promise<{ mime: string; data: string; preview: string }> {
  const blob = await shrinkPhoto(file);
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  return { mime: blob.type || 'image/jpeg', data: dataUrl.slice(dataUrl.indexOf(',') + 1), preview: dataUrl };
}

/**
 * "We got something new": scan it, name it, price it, photograph it. The
 * owner gets it to approve (whoever runs the shop adds it at once).
 */
export function NewProductPage() {
  const t = useT();
  const queryClient = useQueryClient();
  const categories = useQuery({ queryKey: ['categories'], queryFn: categoriesApi.list, staleTime: 5 * 60_000 });
  const [barcode, setBarcode] = useState('');
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [categoryId, setCategoryId] = useState(NO_CATEGORY);
  const [stock, setStock] = useState('0');
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<{ mime: string; data: string; preview: string } | null>(null);
  const [tried, setTried] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);

  const priceValue = Number(price.replace(',', '.'));
  const nameProblem = name.trim() ? null : t.staff.newProduct.needName;
  const priceProblem = price.trim() !== '' && Number.isFinite(priceValue) && priceValue >= 0 ? null : t.staff.newProduct.needPrice;

  const save = useMutation({
    mutationFn: () =>
      teamApi.newProduct({
        name: name.trim(),
        categoryId: categoryId === NO_CATEGORY ? null : Number(categoryId),
        price: priceValue,
        barcode: barcode.trim() || null,
        stock: Math.max(0, Math.floor(Number(stock) || 0)),
        note: note.trim() || null,
        photo: photo ? { mime: photo.mime, data: photo.data } : null,
      }),
    onSuccess: () => {
      for (const key of ['products', 'inventory', 'approvals', 'attention', 'product-requests']) queryClient.invalidateQueries({ queryKey: [key] });
    },
  });

  // After a scan, the name is next.
  const [scanned, setScanned] = useState(0);
  useEffect(() => {
    if (scanned > 0) nameInput.current?.focus();
  }, [scanned]);

  function submit(event: FormEvent) {
    event.preventDefault();
    setTried(true);
    if (!nameProblem && !priceProblem) save.mutate();
  }

  function startOver() {
    setBarcode('');
    setName('');
    setPrice('');
    setCategoryId(NO_CATEGORY);
    setStock('0');
    setNote('');
    setPhoto(null);
    setTried(false);
    save.reset();
  }

  if (save.data) {
    const added = save.data.kind === 'product';
    return (
      <>
        <PageHeader title={added ? t.staff.newProduct.addedTitle : t.staff.newProduct.sentTitle} crumbs={[{ label: t.staff.nav.home, to: '/' }]} />
        <Card>
          <p role="status">{added ? t.staff.newProduct.addedMessage(name.trim()) : t.staff.newProduct.sentMessage(name.trim())}</p>
          <div className="staff-actions">
            <Button variant="primary" onClick={startOver}>
              {t.staff.newProduct.another}
            </Button>
            <ButtonLink to="/">{t.staff.newProduct.home}</ButtonLink>
          </div>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader title={t.staff.newProduct.title} description={`${t.staff.newProduct.intro} ${t.staff.newProduct.introRequest}`} crumbs={[{ label: t.staff.nav.home, to: '/' }]} />
      <form className="settings-form staff-page" onSubmit={submit} noValidate>
        <Field label={t.staff.newProduct.barcode} hint={t.staff.newProduct.barcodeHint}>
          <span className="staff-inline">
            <input type="text" inputMode="numeric" autoComplete="off" value={barcode} onChange={(event) => setBarcode(event.target.value)} />
            <CameraScanButton
              iconOnly
              onScan={(code) => {
                setBarcode(code);
                setScanned((count) => count + 1);
              }}
            />
          </span>
        </Field>
        <Field label={t.staff.newProduct.name} error={tried ? nameProblem : null}>
          <input ref={nameInput} type="text" maxLength={200} placeholder={t.staff.newProduct.namePlaceholder} value={name} onChange={(event) => setName(event.target.value)} aria-invalid={tried && nameProblem ? true : undefined} />
        </Field>
        <div className="field-row">
          <Field label={t.staff.newProduct.price} error={tried ? priceProblem : null} narrow>
            <input type="text" inputMode="decimal" placeholder="0,00" value={price} onChange={(event) => setPrice(event.target.value)} aria-invalid={tried && priceProblem ? true : undefined} />
          </Field>
          <Field label={t.staff.newProduct.onShelf} narrow>
            <input type="number" inputMode="numeric" min={0} step={1} value={stock} onChange={(event) => setStock(event.target.value)} />
          </Field>
        </div>
        <Field label={t.staff.newProduct.category}>
          <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
            <option value={NO_CATEGORY}>{t.staff.newProduct.noCategory}</option>
            {(categories.data ?? []).map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t.staff.newProduct.photo} hint={t.staff.newProduct.photoHint}>
          <span className="staff-photo">
            {photo && <img src={photo.preview} alt="" width={96} height={96} className="staff-photo__preview" />}
            {/* capture opens the camera on a phone; a computer picks a file. */}
            <input
              ref={photoInput}
              type="file"
              accept="image/*"
              capture="environment"
              className="visually-hidden"
              tabIndex={-1}
              aria-hidden="true"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) setPhoto(await photoPayload(file));
              }}
            />
            <Button icon={Camera} onClick={() => photoInput.current?.click()}>
              {t.staff.newProduct.photo}
            </Button>
            {photo && <Button variant="ghost" icon={Trash} aria-label={t.staff.newProduct.removePhoto} title={t.staff.newProduct.removePhoto} onClick={() => setPhoto(null)} />}
          </span>
        </Field>
        <Field label={t.staff.newProduct.note}>
          <input type="text" maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
        {save.isError && (
          <p className="form-error" role="alert">
            {errorMessage(save.error)}
          </p>
        )}
        <Button type="submit" variant="primary" loading={save.isPending}>
          {t.staff.newProduct.send}
        </Button>
      </form>
    </>
  );
}
