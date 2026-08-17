const express = require('express');
const app = express();
app.use(express.json());

const SYSTEM_INSTRUCTION = `
Eres un asistente experto en Roblox Studio.
Cuando el usuario te pida crear o generar algo, responde ÚNICAMENTE con código Luau ejecutable en Roblox Studio.
NO agregues explicaciones, NO uses bloques de código tipo markdown (\`\`\`lua ... \`\`\`), solo entrega el código Luau directo.
El código debe crear los elementos en el Workspace usando Instance.new o manipular propiedades.
REGLAS STRICTAS DE SEGURIDAD:
1. Queda totalmente PROHIBIDO usar :ClearAllChildren(), :Destroy() o cualquier método que borre objetos existentes del Workspace.
2. NUNCA limpies ni vacíes el Workspace completo.
3. Si el usuario pide remover o quitar algo, únicamente elimina ese objeto específico por su nombre exacto, jamás el escenario completo.
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

        res.json({ code: responseText });

    } catch (error) {
        console.error("Error interno en servidor:", error);
        res.status(500).json({ error: error.message || "Error interno al procesar la solicitud" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor activo en el puerto ${PORT}`));
