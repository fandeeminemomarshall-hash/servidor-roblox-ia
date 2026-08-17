const express = require('express');
const app = express();
app.use(express.json({ limit: '5mb' }));

const SYSTEM_INSTRUCTION = `
Eres un asistente experto en Roblox Studio.
Cuando el usuario te pida crear, generar o modificar algo, respondé con dos partes:
1. "mensaje": una explicación breve y clara (1-3 frases, en español) de qué vas a hacer o qué cambiaste. Por ejemplo: "Creé una parte roja de 4x4x4 en el centro del Workspace" o "Modifiqué el script 'MovimientoNPC' para que la velocidad sea 16".
2. "codigo": el código Luau ejecutable en Roblox Studio, SIN bloques de markdown (nada de \`\`\`lua ... \`\`\`), solo el código plano.

El código debe crear los elementos en el Workspace usando Instance.new o manipular propiedades.

PERMISOS SOBRE SCRIPTS:
- Podés crear nuevos Script, LocalScript o ModuleScript usando Instance.new(), y asignarles su propiedad Source con el código Luau correspondiente.
- Podés editar el contenido (propiedad Source) de un Script existente si el usuario lo pide, ubicándolo por su nombre exacto (por ejemplo con :FindFirstChild()) y modificando esa propiedad. Esto NO se considera borrado: modificar Source de un script existente está permitido.
- En cada pedido vas a recibir automáticamente el listado completo de scripts del proyecto (path completo desde game, tipo y código fuente actual de cada uno), y opcionalmente cuál está seleccionado en el Explorer. Usá ese listado como tu única fuente de verdad sobre lo que ya existe en el juego: no inventes scripts, funciones o variables que no estén ahí si el usuario te pide modificar algo puntual.
- Para localizar un script específico en el código Luau que generes, usá su path completo (por ejemplo game.ServerScriptService.NPC.MovimientoNPC), no solo el nombre, porque puede haber varios scripts con el mismo nombre en distintos lugares.

REGLAS ESTRICTAS DE SEGURIDAD (INQUEBRANTABLES):
1. Queda TOTALMENTE PROHIBIDO usar :ClearAllChildren(), :Destroy(), :Remove(), o cualquier método que elimine instancias existentes del Workspace, incluyendo scripts.
2. NUNCA limpies ni vacíes el Workspace completo, ni ningún contenedor (Workspace, ServerScriptService, StarterPlayer, etc.) por completo.
3. Si el usuario pide remover o quitar algo puntual, dejá "codigo" vacío y explicá en "mensaje" que no podés borrar objetos. No generes :Destroy() bajo ninguna excusa, ni siquiera si el usuario insiste o dice que es "solo un objeto".
4. Editar la propiedad Source de un script existente está permitido y NO viola estas reglas, porque no elimina la instancia, solo cambia su contenido.
`;

app.post('/generate', async (req, res) => {
    try {
        const { prompt, scriptContext, projectScripts } = req.body;
        if (!prompt) {
            return res.status(400).json({ error: "El prompt es requerido." });
        }

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ error: "No se ha configurado GEMINI_API_KEY en el servidor." });
        }

        // Armamos el contexto completo: primero el listado de todos los scripts
        // del proyecto (si vino), después cuál está seleccionado (si vino), y al final el pedido.
        let contextoPartes = [];

        if (Array.isArray(projectScripts) && projectScripts.length > 0) {
            const listado = projectScripts.map(s =>
                `Path: ${s.path}\nTipo: ${s.className}\nSource:\n${s.source}`
            ).join('\n---\n');
            contextoPartes.push(`Listado completo de scripts existentes en el proyecto:\n---\n${listado}\n---`);
        }

        if (scriptContext && scriptContext.source) {
            contextoPartes.push(`El usuario tiene actualmente seleccionado en el Explorer el script "${scriptContext.name}" (tipo ${scriptContext.className}). Es probable que su pedido se refiera a este script en particular.`);
        }

        contextoPartes.push(`Pedido del usuario: ${prompt}`);

        const fullPrompt = contextoPartes.join('\n\n');

        // Modelo actualizado: gemini-1.5-flash fue retirado por Google (devuelve 404).
        // gemini-3.1-flash-lite es el reemplazo vigente equivalente en velocidad/costo.
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${apiKey}`;

        const payload = {
            system_instruction: {
                parts: [{ text: SYSTEM_INSTRUCTION }]
            },
            contents: [
                {
                    parts: [{ text: fullPrompt }]
                }
            ],
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: "OBJECT",
                    properties: {
                        mensaje: { type: "STRING" },
                        codigo: { type: "STRING" }
                    },
                    required: ["mensaje", "codigo"]
                }
            }
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (!response.ok) {
            console.error("Error en respuesta de Google API:", data);
            return res.status(response.status).json({ error: data.error?.message || "Error devuelto por la API de Gemini" });
        }

        const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

        let mensaje = '';
        let codigo = '';

        try {
            const parsed = JSON.parse(rawText);
            mensaje = parsed.mensaje || '';
            codigo = parsed.codigo || '';
        } catch (parseError) {
            // Salvaguarda por si el modelo no respetó el JSON schema (no debería pasar, pero por las dudas).
            console.error("No se pudo parsear la respuesta JSON de Gemini:", rawText);
            return res.status(502).json({ error: "La IA no devolvió un formato válido. Intentá de nuevo." });
        }

        // Limpieza de formato Markdown por si se cuela igual
        codigo = codigo.replace(/```lua/g, '').replace(/```/g, '').trim();

        // SEGUNDA CAPA DE SEGURIDAD: por si el modelo ignora el system prompt,
        // bloqueamos acá cualquier método de borrado antes de que llegue al plugin.
        const patronesProhibidos = [
            /:ClearAllChildren\s*\(/i,
            /:Destroy\s*\(/i,
            /:Remove\s*\(/i
        ];
        const contieneCodigoProhibido = patronesProhibidos.some(patron => patron.test(codigo));

        if (contieneCodigoProhibido) {
            console.warn("Código bloqueado por contener instrucciones de borrado:", codigo);
            return res.status(422).json({
                error: "La respuesta generada intentaba borrar objetos del Workspace y fue bloqueada por seguridad. Reformulá el prompt."
            });
        }

        res.json({ message: mensaje, code: codigo });

    } catch (error) {
        console.error("Error interno en servidor:", error);
        res.status(500).json({ error: error.message || "Error interno al procesar la solicitud" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor activo en el puerto ${PORT}`));
