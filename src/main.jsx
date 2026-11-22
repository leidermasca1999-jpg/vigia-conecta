import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { supabase } from "./supabase";
import "./styles.css";

const money = (value) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));

const emptyNoticeForm = {
  title: "",
  content: "",
  notice_type: "Información",
  starts_at: "",
  ends_at: "",
  is_published: false,
};

const toLocalDateTime = (value) => {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 16);
};

const fromLocalDateTime = (value) =>
  value ? new Date(value).toISOString() : null;

const emptyForm = {
  origin: "Vigía del Fuerte",
  destination: "",
  transport: "Fluvial",
  departure: "",
  frequency: "",
  price: "",
  status: "Por confirmar",
  notes: "",
  scheduleType: "Fijo",
};

function App() {
  const [routes, setRoutes] = useState([]);
  const [query, setQuery] = useState("");
  const [transport, setTransport] = useState("Todos");
  const [selected, setSelected] = useState(null);
  const [session, setSession] = useState(null);
  const [admin, setAdmin] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(null);
  const [notice, setNotice] = useState("");
  const [showAdmin, setShowAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notices, setNotices] = useState([]);
  const [noticeForm, setNoticeForm] = useState(emptyNoticeForm);
  const [editingNotice, setEditingNotice] = useState(null);
  const [noticeSaving, setNoticeSaving] = useState(false);

  useEffect(() => {
    let alive = true;

    async function start() {
      const { data, error } = await supabase.auth.getSession();
      if (error) console.error("Error al recuperar sesión:", error);
      if (alive && data?.session) {
        setSession(data.session);
        await checkAdmin(data.session.user.id, alive);
      }
      if (alive) await loadRoutes(alive);
    }

    start();

    const { data: listener } = supabase.auth.onAuthStateChange(
      async (_event, nextSession) => {
        setSession(nextSession);
        if (nextSession?.user) {
          await checkAdmin(nextSession.user.id, true);
        } else {
          setAdmin(false);
          setShowAdmin(false);
        }
      }
    );

    return () => {
      alive = false;
      listener?.subscription?.unsubscribe();
    };
  }, []);

  useEffect(() => {
    loadNotices(admin);
  }, [admin]);

  async function loadNotices(isAdministrator = admin) {
    let request = supabase
      .from("notices")
      .select("id,title,content,notice_type,starts_at,ends_at,is_published,created_at")
      .order("created_at", { ascending: false });

    if (!isAdministrator) request = request.eq("is_published", true);

    const { data, error } = await request;
    if (error) {
      console.error("Error consultando avisos:", error);
      setNotices([]);
      if (isAdministrator) {
        setNotice("No fue posible cargar los avisos. Revisa los permisos de la tabla notices en Supabase.");
      }
      return;
    }

    const now = Date.now();
    const visible = (data || []).filter((item) => {
      if (isAdministrator) return true;
      const starts = item.starts_at ? new Date(item.starts_at).getTime() : null;
      const ends = item.ends_at ? new Date(item.ends_at).getTime() : null;
      return (starts === null || starts <= now) && (ends === null || ends >= now);
    });
    setNotices(visible);
  }

  async function saveNotice(e) {
    e.preventDefault();
    if (!admin || !session?.user?.id) {
      setNotice("Necesitas una cuenta administradora para publicar avisos.");
      return;
    }
    if (!noticeForm.title.trim() || !noticeForm.content.trim()) {
      setNotice("Completa el título y el contenido del aviso.");
      return;
    }

    setNoticeSaving(true);
    const payload = {
      title: noticeForm.title.trim(),
      content: noticeForm.content.trim(),
      notice_type: noticeForm.notice_type,
      starts_at: fromLocalDateTime(noticeForm.starts_at),
      ends_at: fromLocalDateTime(noticeForm.ends_at),
      is_published: noticeForm.is_published,
      created_by: session.user.id,
    };

    try {
      if (payload.starts_at && payload.ends_at &&
          new Date(payload.ends_at) < new Date(payload.starts_at)) {
        throw new Error("La fecha de finalización no puede ser anterior al inicio.");
      }

      let result;
      if (editingNotice) {
        const { created_by, ...updatePayload } = payload;
        result = await supabase.from("notices").update(updatePayload).eq("id", editingNotice);
      } else {
        result = await supabase.from("notices").insert(payload);
      }
      if (result.error) throw result.error;

      setNoticeForm(emptyNoticeForm);
      setEditingNotice(null);
      await loadNotices(true);
      setNotice(editingNotice ? "Aviso actualizado correctamente." : "Aviso creado correctamente.");
    } catch (error) {
      console.error("Error guardando aviso:", error);
      setNotice(`No se pudo guardar el aviso: ${error.message || "revisa los permisos de Supabase."}`);
    } finally {
      setNoticeSaving(false);
    }
  }

  function editNotice(item) {
    setEditingNotice(item.id);
    setNoticeForm({
      title: item.title || "",
      content: item.content || "",
      notice_type: item.notice_type || "Información",
      starts_at: toLocalDateTime(item.starts_at),
      ends_at: toLocalDateTime(item.ends_at),
      is_published: Boolean(item.is_published),
    });
    document.getElementById("avisos-admin")?.scrollIntoView({ behavior: "smooth" });
  }

  async function deleteNotice(id) {
    if (!admin) return;
    if (!window.confirm("¿Seguro que deseas eliminar este aviso?")) return;
    const { error } = await supabase.from("notices").delete().eq("id", id);
    if (error) {
      console.error("Error eliminando aviso:", error);
      setNotice(`No se pudo eliminar el aviso: ${error.message}`);
      return;
    }
    if (editingNotice === id) {
      setEditingNotice(null);
      setNoticeForm(emptyNoticeForm);
    }
    await loadNotices(true);
    setNotice("Aviso eliminado correctamente.");
  }

  async function checkAdmin(userId, alive = true) {
    const { data, error } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .maybeSingle();

    if (error) {
      console.error("No se pudo verificar el rol:", error);
      if (alive) {
        setAdmin(false);
        setNotice("No se pudo verificar el permiso de administrador.");
      }
      return false;
    }

    const isAdmin = data?.role === "admin";
    if (alive) setAdmin(isAdmin);
    return isAdmin;
  }

  async function loadRoutes(alive = true) {
    setLoading(true);
    const { data, error } = await supabase
      .from("routes")
      .select(`
        id,
        origin,
        transport_type,
        route_name,
        description,
        departure_point,
        schedule_type,
        verification_status,
        is_published,
        destinations ( name ),
        schedules ( id, departure_time, frequency, notes ),
        fares ( id, amount, currency, notes )
      `)
      .eq("is_published", true)
      .order("route_name");

    if (error) {
      console.error("Error consultando rutas:", error);
      if (alive) {
        setRoutes([]);
        setNotice("No fue posible cargar las rutas. Revisa la conexión y los permisos de Supabase.");
      }
    } else if (alive) {
      const mapped = (data || []).map((r) => {
        const schedule = r.schedules?.[0] || {};
        const fare = r.fares?.[0] || {};
        return {
          id: r.id,
          origin: r.origin,
          destination: r.destinations?.name || r.route_name,
          transport: r.transport_type,
          departure: schedule.departure_time || "Por consultar",
          frequency: schedule.frequency || "Por consultar",
          price: fare.amount ?? 0,
          currency: fare.currency || "COP",
          status: r.verification_status,
          notes: [
            r.departure_point,
            r.description,
            schedule.notes,
            fare.notes,
          ].filter(Boolean).join(" "),
          scheduleType: r.schedule_type,
        };
      });
      setRoutes(mapped);
      setSelected((current) =>
        current ? mapped.find((r) => r.id === current.id) || null : null
      );
    }
    if (alive) setLoading(false);
  }

  const filtered = useMemo(
    () =>
      routes.filter((r) => {
        const text =
          `${r.origin} ${r.destination} ${r.transport} ${r.notes}`.toLowerCase();
        return (
          text.includes(query.toLowerCase()) &&
          (transport === "Todos" || r.transport === transport)
        );
      }),
    [routes, query, transport]
  );

  async function saveRoute(e) {
    e.preventDefault();
    if (
      !form.destination.trim() ||
      !form.departure.trim() ||
      !form.frequency.trim()
    ) {
      setNotice("Completa destino, horario y frecuencia.");
      return;
    }
    if (!admin) {
      setNotice("Necesitas una cuenta administradora para guardar cambios.");
      return;
    }

    setSaving(true);
    try {
      let destinationId;

      const { data: existingDestination, error: destinationSearchError } =
        await supabase
          .from("destinations")
          .select("id")
          .ilike("name", form.destination.trim())
          .limit(1)
          .maybeSingle();

      if (destinationSearchError) throw destinationSearchError;

      if (existingDestination) {
        destinationId = existingDestination.id;
      } else {
        const { data: newDestination, error: destinationInsertError } =
          await supabase
            .from("destinations")
            .insert({
              name: form.destination.trim(),
              department: form.destination.trim().toLowerCase() === "quibdó"
                ? "Chocó"
                : "Antioquia",
              is_active: true,
            })
            .select("id")
            .single();

        if (destinationInsertError) throw destinationInsertError;
        destinationId = newDestination.id;
      }

      const routePayload = {
        origin: form.origin.trim(),
        destination_id: destinationId,
        transport_type: form.transport,
        route_name: `${form.origin.trim()} - ${form.destination.trim()}`,
        description: form.notes.trim() || null,
        departure_point:
          "Puesto principal de la terminal de transporte de Vigía del Fuerte",
        schedule_type: form.scheduleType,
        verification_status: form.status,
        is_published: true,
      };

      let routeId = editing;
      if (editing) {
        const { error } = await supabase
          .from("routes")
          .update(routePayload)
          .eq("id", editing);
        if (error) throw error;
      } else {
        const { data: newRoute, error } = await supabase
          .from("routes")
          .insert(routePayload)
          .select("id")
          .single();
        if (error) throw error;
        routeId = newRoute.id;
      }

      const { data: oldSchedules, error: scheduleReadError } = await supabase
        .from("schedules")
        .select("id")
        .eq("route_id", routeId);
      if (scheduleReadError) throw scheduleReadError;

      if (oldSchedules?.length) {
        const { error } = await supabase
          .from("schedules")
          .update({
            departure_time: form.departure.trim(),
            frequency: form.frequency.trim(),
            notes: "Horario informado; confirmar antes de viajar.",
            is_active: true,
          })
          .eq("id", oldSchedules[0].id);
        if (error) throw error;
        if (oldSchedules.length > 1) {
          const extraIds = oldSchedules.slice(1).map((item) => item.id);
          const { error: cleanupError } = await supabase
            .from("schedules")
            .delete()
            .in("id", extraIds);
          if (cleanupError) throw cleanupError;
        }
      } else {
        const { error } = await supabase.from("schedules").insert({
          route_id: routeId,
          departure_time: form.departure.trim(),
          frequency: form.frequency.trim(),
          notes: "Horario informado; confirmar antes de viajar.",
          is_active: true,
        });
        if (error) throw error;
      }

      const { data: oldFares, error: fareReadError } = await supabase
        .from("fares")
        .select("id")
        .eq("route_id", routeId);
      if (fareReadError) throw fareReadError;

      const farePayload = {
        amount: Number(form.price || 0),
        currency: "COP",
        notes: "Tarifa informada; pendiente de confirmación con el prestador.",
        is_active: true,
      };

      if (oldFares?.length) {
        const { error } = await supabase
          .from("fares")
          .update(farePayload)
          .eq("id", oldFares[0].id);
        if (error) throw error;
        if (oldFares.length > 1) {
          const extraIds = oldFares.slice(1).map((item) => item.id);
          const { error: cleanupError } = await supabase
            .from("fares")
            .delete()
            .in("id", extraIds);
          if (cleanupError) throw cleanupError;
        }
      } else {
        const { error } = await supabase
          .from("fares")
          .insert({ route_id: routeId, ...farePayload });
        if (error) throw error;
      }

      setForm(emptyForm);
      setEditing(null);
      await loadRoutes();
      setNotice(editing ? "Ruta actualizada en Supabase." : "Ruta agregada en Supabase.");
    } catch (error) {
      console.error("Error guardando ruta:", error);
      setNotice(`No se pudo guardar: ${error.message || "revisa los permisos de Supabase."}`);
    } finally {
      setSaving(false);
    }
  }

  function editRoute(route) {
    setEditing(route.id);
    setForm({
      origin: route.origin,
      destination: route.destination,
      transport: route.transport,
      departure: route.departure,
      frequency: route.frequency,
      price: String(route.price ?? ""),
      status: route.status || "Por confirmar",
      notes: route.notes || "",
      scheduleType: route.scheduleType || "Fijo",
    });
    setShowAdmin(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function deleteRoute(id) {
    if (!admin) return;
    if (!window.confirm("¿Seguro que deseas eliminar esta ruta?")) return;

    const { error } = await supabase.from("routes").delete().eq("id", id);
    if (error) {
      console.error("Error eliminando ruta:", error);
      setNotice(`No se pudo eliminar: ${error.message}`);
      return;
    }
    if (selected?.id === id) setSelected(null);
    await loadRoutes();
    setNotice("Ruta eliminada de Supabase.");
  }

  async function login(e) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const email = String(data.get("email") || "").trim();
    const password = String(data.get("password") || "");

    const { data: authData, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setNotice("No se pudo iniciar sesión. Verifica el correo y la contraseña de tu usuario de Supabase.");
      return;
    }

    const isAdmin = await checkAdmin(authData.user.id);
    if (!isAdmin) {
      await supabase.auth.signOut();
      setNotice("La cuenta inició sesión, pero no tiene permisos de administrador.");
      return;
    }

    setSession(authData.session);
    setAdmin(true);
    setLoginOpen(false);
    setShowAdmin(true);
    setNotice("Sesión de administrador iniciada.");
  }

  async function logout() {
    await supabase.auth.signOut();
    setSession(null);
    setAdmin(false);
    setShowAdmin(false);
    setEditing(null);
    setForm(emptyForm);
    setNotice("Sesión cerrada.");
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a
          className="brand"
          href="#"
          onClick={() => {
            setSelected(null);
            setShowAdmin(false);
          }}
        >
          <span className="brand-mark">VC</span>
          <span>
            <strong>Vigía Conecta</strong>
            <small>Movilidad fluvial y aérea</small>
          </span>
        </a>
        <nav>
          <a href="#rutas" onClick={() => setShowAdmin(false)}>
            Consultar rutas
          </a>
          <a href="#acerca">Acerca del servicio</a>
          {admin ? (
            <button
              className="nav-button"
              onClick={() => setShowAdmin((v) => !v)}
            >
              {showAdmin ? "Ver consulta" : "Administrar"}
            </button>
          ) : (
            <button className="nav-button" onClick={() => setLoginOpen(true)}>
              Administración
            </button>
          )}
        </nav>
      </header>

      <main>
        <section className="hero">
          <div className="hero-content">
            <div className="eyebrow">
              <span className="pulse"></span> INFORMACIÓN DE MOVILIDAD LOCAL
            </div>
            <h1>
              Conoce tus rutas.
              <br />
              <em>Planea tu viaje.</em>
            </h1>
            <p>
              Consulta información de transporte fluvial y aéreo con origen en
              Vigía del Fuerte, Antioquia.
            </p>
            <a className="primary-link" href="#rutas">
              Explorar rutas <span>↓</span>
            </a>
          </div>
          <div className="hero-art" aria-hidden="true">
            <div className="sun"></div>
            <div className="river river-one"></div>
            <div className="river river-two"></div>
            <div className="boat">
              <span></span>
            </div>
            <div className="bird bird-one">⌁</div>
            <div className="bird bird-two">⌁</div>
            <div className="hero-label">
              VIGÍA DEL FUERTE <span>•</span> ANTIOQUIA
            </div>
          </div>
        </section>

        {notice && (
          <div className="toast" role="status">
            {notice}
          </div>
        )}

        {!showAdmin && notices.length > 0 && (
          <section className="public-notices" aria-labelledby="public-notices-title">
            <div className="section-heading">
              <div>
                <div className="eyebrow dark">NOVEDADES DEL SERVICIO</div>
                <h2 id="public-notices-title">Avisos y comunicados</h2>
                <p>Información publicada para habitantes y visitantes.</p>
              </div>
            </div>
            <div className="public-notice-grid">
              {notices.map((item) => (
                <article className={`public-notice-card notice-${(item.notice_type || "Información").toLowerCase()}`} key={item.id}>
                  <div className="public-notice-meta">
                    <span>{item.notice_type}</span>
                    <small>{item.created_at ? new Date(item.created_at).toLocaleDateString("es-CO") : ""}</small>
                  </div>
                  <h3>{item.title}</h3>
                  <p>{item.content}</p>
                  {(item.starts_at || item.ends_at) && (
                    <small className="notice-validity">
                      Vigencia: {item.starts_at ? new Date(item.starts_at).toLocaleString("es-CO") : "Desde su publicación"}
                      {item.ends_at ? ` · Hasta ${new Date(item.ends_at).toLocaleString("es-CO")}` : ""}
                    </small>
                  )}
                </article>
              ))}
            </div>
          </section>
        )}

        {showAdmin && admin ? (
          <section className="admin-section" id="admin">
            <div className="section-heading">
              <div>
                <div className="eyebrow dark">PANEL DE CONTROL</div>
                <h2>Administrar rutas</h2>
                <p>Gestiona la información que se muestra en el catálogo público.</p>
              </div>
              <button className="outline-button" onClick={logout}>
                Cerrar sesión
              </button>
            </div>
            <div className="admin-grid">
              <form className="route-form" onSubmit={saveRoute}>
                <h3>{editing ? "Editar ruta" : "Agregar nueva ruta"}</h3>
                <div className="form-grid">
                  <label>
                    Origen
                    <input
                      value={form.origin}
                      onChange={(e) =>
                        setForm({ ...form, origin: e.target.value })
                      }
                      required
                    />
                  </label>
                  <label>
                    Destino
                    <input
                      value={form.destination}
                      onChange={(e) =>
                        setForm({ ...form, destination: e.target.value })
                      }
                      placeholder="Ej. Quibdó"
                      required
                    />
                  </label>
                  <label>
                    Tipo de transporte
                    <select
                      value={form.transport}
                      onChange={(e) =>
                        setForm({ ...form, transport: e.target.value })
                      }
                    >
                      <option>Fluvial</option>
                      <option>Aéreo</option>
                    </select>
                  </label>
                  <label>
                    Horario
                    <input
                      value={form.departure}
                      onChange={(e) =>
                        setForm({ ...form, departure: e.target.value })
                      }
                      placeholder="Ej. 8:00 a. m."
                      required
                    />
                  </label>
                  <label>
                    Frecuencia
                    <input
                      value={form.frequency}
                      onChange={(e) =>
                        setForm({ ...form, frequency: e.target.value })
                      }
                      placeholder="Ej. Todos los días"
                      required
                    />
                  </label>
                  <label>
                    Precio (COP)
                    <input
                      type="number"
                      min="0"
                      value={form.price}
                      onChange={(e) =>
                        setForm({ ...form, price: e.target.value })
                      }
                      placeholder="150000"
                    />
                  </label>
                  <label>
                    Tipo de horario
                    <select
                      value={form.scheduleType}
                      onChange={(e) =>
                        setForm({ ...form, scheduleType: e.target.value })
                      }
                    >
                      <option>Fijo</option>
                      <option>Variable</option>
                    </select>
                  </label>
                  <label>
                    Estado de verificación
                    <select
                      value={form.status}
                      onChange={(e) =>
                        setForm({ ...form, status: e.target.value })
                      }
                    >
                      <option>Por confirmar</option>
                      <option>Confirmado por prestador</option>
                      <option>Información desactualizada</option>
                    </select>
                  </label>
                  <label className="full">
                    Observaciones
                    <textarea
                      rows="3"
                      value={form.notes}
                      onChange={(e) =>
                        setForm({ ...form, notes: e.target.value })
                      }
                      placeholder="Detalles importantes para el viajero..."
                    />
                  </label>
                </div>
                <div className="form-actions">
                  <button className="primary-button" type="submit" disabled={saving}>
                    {saving
                      ? "Guardando..."
                      : editing
                        ? "Guardar cambios"
                        : "Agregar ruta"}
                  </button>
                  {editing && (
                    <button
                      type="button"
                      className="outline-button"
                      onClick={() => {
                        setEditing(null);
                        setForm(emptyForm);
                      }}
                    >
                      Cancelar
                    </button>
                  )}
                </div>
              </form>
              <div className="manage-list">
                <h3>
                  Rutas registradas <span>{routes.length}</span>
                </h3>
                {routes.map((r) => (
                  <div className="manage-item" key={r.id}>
                    <div>
                      <strong>{r.destination}</strong>
                      <small>
                        {r.transport} · {r.departure} · {money(r.price)}
                      </small>
                    </div>
                    <div className="manage-actions">
                      <button onClick={() => editRoute(r)}>Editar</button>
                      <button
                        className="danger-text"
                        onClick={() => deleteRoute(r.id)}
                      >
                        Eliminar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <section className="notice-admin" id="avisos-admin">
              <div className="section-heading">
                <div>
                  <div className="eyebrow dark">COMUNICACIÓN A USUARIOS</div>
                  <h2>Administrar avisos</h2>
                  <p>Crea comunicados sobre información, clima, operación o alertas.</p>
                </div>
                <div className="route-count">
                  <strong>{notices.length.toString().padStart(2, "0")}</strong>
                  <span>avisos registrados</span>
                </div>
              </div>
              <div className="admin-grid notice-admin-grid">
                <form className="route-form" onSubmit={saveNotice}>
                  <h3>{editingNotice ? "Editar aviso" : "Crear nuevo aviso"}</h3>
                  <div className="form-grid">
                    <label className="full">
                      Título
                      <input value={noticeForm.title} onChange={(e) => setNoticeForm({ ...noticeForm, title: e.target.value })} maxLength="140" required placeholder="Ej. Cambio temporal en el servicio" />
                    </label>
                    <label>
                      Tipo de aviso
                      <select value={noticeForm.notice_type} onChange={(e) => setNoticeForm({ ...noticeForm, notice_type: e.target.value })}>
                        <option>Información</option>
                        <option>Clima</option>
                        <option>Operación</option>
                        <option>Alerta</option>
                      </select>
                    </label>
                    <label className="full">
                      Contenido
                      <textarea rows="5" value={noticeForm.content} onChange={(e) => setNoticeForm({ ...noticeForm, content: e.target.value })} required placeholder="Escribe la información que deben conocer los usuarios..." />
                    </label>
                    <label>
                      Mostrar desde
                      <input type="datetime-local" value={noticeForm.starts_at} onChange={(e) => setNoticeForm({ ...noticeForm, starts_at: e.target.value })} />
                    </label>
                    <label>
                      Mostrar hasta
                      <input type="datetime-local" value={noticeForm.ends_at} onChange={(e) => setNoticeForm({ ...noticeForm, ends_at: e.target.value })} />
                    </label>
                    <label className="notice-publish-toggle full">
                      <input type="checkbox" checked={noticeForm.is_published} onChange={(e) => setNoticeForm({ ...noticeForm, is_published: e.target.checked })} />
                      Publicar aviso para los visitantes
                    </label>
                  </div>
                  <div className="form-actions">
                    <button className="primary-button" type="submit" disabled={noticeSaving}>
                      {noticeSaving ? "Guardando..." : editingNotice ? "Guardar cambios" : "Crear aviso"}
                    </button>
                    {editingNotice && (
                      <button type="button" className="outline-button" onClick={() => { setEditingNotice(null); setNoticeForm(emptyNoticeForm); }}>
                        Cancelar
                      </button>
                    )}
                  </div>
                </form>
                <div className="manage-list">
                  <h3>Avisos registrados <span>{notices.length}</span></h3>
                  {notices.length ? notices.map((item) => (
                    <div className="manage-item" key={item.id}>
                      <div className="notice-manage-copy">
                        <strong>{item.title}</strong>
                        <small>{item.notice_type} · {item.is_published ? "Publicado" : "Borrador"}</small>
                      </div>
                      <div className="manage-actions">
                        <button onClick={() => editNotice(item)}>Editar</button>
                        <button className="danger-text" onClick={() => deleteNotice(item.id)}>Eliminar</button>
                      </div>
                    </div>
                  )) : <p className="notice-empty">Aún no hay avisos registrados.</p>}
                </div>
              </div>
              <p className="local-warning">Los avisos no reemplazan la confirmación directa con los prestadores. Los avisos no publicados solo son visibles desde este panel.</p>
            </section>

            <p className="local-warning">
              Los cambios se guardan en Supabase y pueden consultarse desde
              otros dispositivos. Las tarifas y horarios siguen sujetos a
              confirmación con los prestadores.
            </p>
          </section>
        ) : (
          <section className="routes-section" id="rutas">
            <div className="section-heading">
              <div>
                <div className="eyebrow dark">DIRECTORIO DE TRANSPORTE</div>
                <h2>Encuentra tu ruta</h2>
                <p>Explora los destinos y revisa los detalles disponibles.</p>
              </div>
              <div className="route-count">
                <strong>{filtered.length.toString().padStart(2, "0")}</strong>
                <span>rutas encontradas</span>
              </div>
            </div>
            <div className="filters">
              <div className="searchbox">
                <span>⌕</span>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar destino o lugar..."
                  aria-label="Buscar rutas"
                />
              </div>
              <div className="filter-tabs">
                {["Todos", "Fluvial", "Aéreo"].map((t) => (
                  <button
                    key={t}
                    className={transport === t ? "active" : ""}
                    onClick={() => setTransport(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
            {loading ? (
              <div className="empty-state">
                <h3>Cargando rutas...</h3>
                <p>Consultando la información guardada en Supabase.</p>
              </div>
            ) : filtered.length ? (
              <div className="route-grid">
                {filtered.map((r) => (
                  <article className="route-card" key={r.id}>
                    <div className={`route-visual ${r.transport.toLowerCase()}`}>
                      <span className="transport-tag">{r.transport}</span>
                      <span className="route-symbol">
                        {r.transport === "Fluvial" ? "≈" : "✈"}
                      </span>
                      <span className="visual-caption">VIGÍA DEL FUERTE</span>
                    </div>
                    <div className="route-info">
                      <div className="route-meta">
                        <span>ORIGEN</span>
                        <span>DESTINO</span>
                      </div>
                      <div className="route-pair">
                        <strong>{r.origin}</strong>
                        <i>→</i>
                        <strong>{r.destination}</strong>
                      </div>
                      <div className="card-details">
                        <div>
                          <small>HORARIO</small>
                          <strong>{r.departure}</strong>
                        </div>
                        <div>
                          <small>FRECUENCIA</small>
                          <strong>{r.frequency}</strong>
                        </div>
                      </div>
                      <div className="card-bottom">
                        <div>
                          <small>TARIFA INFORMADA</small>
                          <strong>{money(r.price)}</strong>
                        </div>
                        <button onClick={() => setSelected(r)}>
                          Ver detalles <span>↗</span>
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <span>⌕</span>
                <h3>No encontramos rutas</h3>
                <p>
                  {routes.length
                    ? "Prueba con otro destino o cambia el filtro de transporte."
                    : "Todavía no hay rutas publicadas o no fue posible leerlas desde la base de datos."}
                </p>
                <button
                  className="outline-button"
                  onClick={() => {
                    setQuery("");
                    setTransport("Todos");
                    loadRoutes();
                  }}
                >
                  Actualizar rutas
                </button>
              </div>
            )}
          </section>
        )}

        <section className="notice-section" id="acerca">
          <div className="notice-icon">i</div>
          <div>
            <h3>Información importante para tu viaje</h3>
            <p>
              Este es un sistema de consulta informativa. Los horarios, tarifas
              y frecuencias pueden cambiar por condiciones climáticas,
              operativas o decisiones de los prestadores. Confirma la
              información antes de viajar.
            </p>
            <small>
              La aplicación no vende tiquetes, no reserva cupos, no rastrea
              embarcaciones o aeronaves y no garantiza la prestación del
              servicio.
            </small>
          </div>
        </section>
      </main>

      <footer>
        <div className="footer-brand">
          <span className="brand-mark">VC</span>
          <strong>Vigía Conecta</strong>
        </div>
        <p>Información de movilidad para Vigía del Fuerte, Antioquia.</p>
        <span>Proyecto académico · Ingeniería de Sistemas</span>
      </footer>

      {selected && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setSelected(null);
          }}
        >
          <section
            className="detail-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="detail-title"
          >
            <button
              className="close-button"
              onClick={() => setSelected(null)}
              aria-label="Cerrar"
            >
              ×
            </button>
            <div className={`detail-banner ${selected.transport.toLowerCase()}`}>
              <span>{selected.transport}</span>
              <div>{selected.transport === "Fluvial" ? "≈" : "✈"}</div>
            </div>
            <div className="detail-body">
              <div className="eyebrow dark">DETALLE DE LA RUTA</div>
              <h2 id="detail-title">
                {selected.origin} <span>→</span> {selected.destination}
              </h2>
              <div className="detail-facts">
                <div>
                  <small>HORARIO DE SALIDA</small>
                  <strong>{selected.departure}</strong>
                </div>
                <div>
                  <small>FRECUENCIA</small>
                  <strong>{selected.frequency}</strong>
                </div>
                <div>
                  <small>TARIFA INFORMADA</small>
                  <strong>{money(selected.price)}</strong>
                </div>
                <div>
                  <small>TIPO DE HORARIO</small>
                  <strong>{selected.scheduleType || "Fijo"}</strong>
                </div>
              </div>
              <div className="detail-note">
                <strong>Observaciones</strong>
                <p>
                  {selected.notes ||
                    "No se han registrado observaciones adicionales."}
                </p>
              </div>
              <div className="verification">
                <span>●</span> {selected.status || "Por confirmar"}{" "}
                <small>· Verifica con el prestador antes de viajar.</small>
              </div>
              <button
                className="primary-button wide"
                onClick={() => setSelected(null)}
              >
                Entendido
              </button>
            </div>
          </section>
        </div>
      )}

      {loginOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setLoginOpen(false);
          }}
        >
          <form className="login-modal" onSubmit={login}>
            <button
              type="button"
              className="close-button"
              onClick={() => setLoginOpen(false)}
            >
              ×
            </button>
            <div className="eyebrow dark">ACCESO RESTRINGIDO</div>
            <h2>Administración</h2>
            <p>Ingresa con el correo y la contraseña de tu cuenta administradora.</p>
            <label>
              Correo electrónico
              <input
                name="email"
                type="email"
                autoComplete="username"
                required
                placeholder="tu correo de administrador"
              />
            </label>
            <label>
              Contraseña
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
                placeholder="Contraseña"
              />
            </label>
            <button className="primary-button wide" type="submit">
              Iniciar sesión
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
