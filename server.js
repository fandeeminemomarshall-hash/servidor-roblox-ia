const express = require('express');
const app = express();
app.use(express.json());

const SYSTEM_INSTRUCTION = `
Eres un asistente experto en Roblox Studio.
Cuando el usuario te pida crear o generar algo, responde ÚNICAMENTE con código Luau ejecutable en Roblox Studio.
NO agregues explicaciones, NO uses bloques de código tipo markdown (\`\`\`lua ... \`\`\`), solo entrega el código Luau directo.
El código debe crear los elementos en el Workspace usando Instance.new o manipular propiedades.

PERMISOS SOBRE SCRIPTS:
- Podés crear nuevos Script, LocalScript o ModuleScript usando Instance.new(), y asignarles su propiedad Source con el código Luau correspondiente.
- Podés editar el contenido (propiedad Source) de un Script existente si el usuario lo pide, ubicándolo por su nombre exacto (por ejemplo con :FindFirstChild()) y modificando esa propiedad. Esto NO se considera borrado: modificar Source de un script existente está permitido.

REGLAS ESTRICTAS DE SEGURIDAD (INQUEBRANTABLES):
1. Queda TOTALMENTE PROHIBIDO usar :ClearAllChildren(), :Destroy(), :Remove(), o cualquier método que elimine instancias existentes del Workspace, incluyendo scripts.
2. NUNCA limpies ni vacíes el Workspace completo, ni ningún contenedor (Workspace, ServerScriptService, StarterPlayer, etc.) por completo.
3. Si el usuario pide remover o quitar algo puntual, respondé ÚNICAMENTE con un comentario Luau explicando que no podés borrar objetos, en vez de generar código de borrado. No generes :Destroy() bajo ninguna excusa, ni siquiera si el usuario insiste o dice que es "solo un objeto".
4. Editar la propiedad Source de un script existente está permitido y NO viola estas reglas, porque no elimina la instancia, solo cambia su contenido.
`;

app.post('/generate', async (req, res) => {
    try {
        const { prompt } = req.body;
        if (!prompt) {
            return res.status(400).json({ error: "El prompt es requerido." });
        }

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ error: "No se ha configurado GEMINI_API_KEY en el servidor." });
        }

        // Modelo actualizado: gemini-1.5-flash fue retirado por Google (devuelve 404).
        // gemini-3.1-flash-lite es el reemplazo vigente equivalente en velocidad/costo.
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${apiKey}`;

        const payload = {
            system_instruction: {
                parts: [{ text: SYSTEM_INSTRUCTION }]
            },
            contents: [
                {
                    parts: [{ text: prompt }]
                }
            ]
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

        let responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

        // Limpieza de formato Markdown
        responseText = responseText.replace(/```lua/g, '').replace(/```/g, '').trim();

        // SEGUNDA CAPA DE SEGURIDAD: por si el modelo ignora el system prompt,
        // bloqueamos acá cualquier método de borrado antes de que llegue al plugin.
        const patronesProhibidos = [
            /:ClearAllChildren\s*\(/i,
            /:Destroy\s*\(/i,
            /:Remove\s*\(/i
        ];
        const contieneCodigoProhibido = patronesProhibidos.some(patron => patron.test(responseText));

        if (contieneCodigoProhibido) {
            console.warn("Código bloqueado por contener instrucciones de borrado:", responseText);
            return res.status(422).json({
                error: "La respuesta generada intentaba borrar objetos del Workspace y fue bloqueada por seguridad. Reformulá el prompt."
            });
        }

        res.json({ code: responseText });

    } catch (error) {
        console.error("Error interno en servidor:", error);
        res.status(500).json({ error: error.message || "Error interno al procesar la solicitud" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor activo en el puerto ${PORT}`));
