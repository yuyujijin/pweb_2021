const express = require('express');
const formidable = require('formidable')
const fs = require('fs');

// Pour le CORS dans le header (autorise les requêtes via d'autre servers)
var cors = require('cors');

var app = express();

app.use(cors());
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const img_upload_path = '../app_front/src/assets/profil_pictures/';

const { Client } = require('pg');
const client = new Client({
    user: 'yasmclient',
    host: 'localhost',
    database: 'yasm',
    password: 'pwd',
    port: 5432
});
client.connect().catch(err => { console.log(err) });

const DEFAULT_ERROR_MSG = "Une erreur est survenue lors de votre requête... Veuillez réessayer."

// Permet de récupèrer les publications 
app.get('/publications', async (req, res) => {
    try {
        let user_id = parseInt(req.query.user_id);
        let max_id = req.query.max_id;
        // On récupère les nouveaux posts
        let q = await client.query("SELECT * FROM post p JOIN client c on p.id_client = c.id_client WHERE p.id_post > $1 ORDER BY p.id_post", [max_id]);
        // Puis les likes associés
        for (e in q.rows) {
            // On récupère les likes
            let l = await client.query("SELECT * FROM post_like WHERE id_post = $1", [q.rows[e].id_post]);
            q.rows[e].likes = l.rows;

            // Enfin, on regarde si l'utilisateur a liké
            if (!q.rows[e].likes) return res.json({ worked: false, errors: [DEFAULT_ERROR_MSG] })
            q.rows[e].liked = q.rows[e].likes.some(e => e.id_client === user_id);
        }
        return res.json({ worked: true, result: q.rows, errors: [] });
    } catch {
        return res.json({ worked: false, errors: [DEFAULT_ERROR_MSG] })
    }
});

app.post('/send_publication', async (req, res) => {
    try {
        let user_id = parseInt(req.body.user_id);
        let message = req.body.message;
        // On insère le post
        await client.query("INSERT INTO post(id_client, content) VALUES ($1, $2);", [user_id, message])

        // On retourne une réponse positive
        return res.json({ worked: true, errors: [] });
    } catch {
        return res.json({ worked: false, errors: [DEFAULT_ERROR_MSG] })
    }
});

app.post('/like_publication', async (req, res) => {
    try {
        let user_id = parseInt(req.body.user_id);
        let post_id = req.body.post_id;
        let liked = req.body.liked;

        let n = await (await client.query("SELECT * FROM post_like WHERE id_client = $1 AND id_post = $2;", [user_id, post_id])).rowCount;
        if (liked && n == 0) {
            await client.query("INSERT INTO post_like(id_client, id_post) VALUES ($1, $2);", [user_id, post_id]);
        } else if (n > 0) {
            await client.query("DELETE FROM post_like WHERE id_client = $1 AND id_post =  $2;", [user_id, post_id]);
        } else {
            res.json({ worked: false, errors: ["Une erreur est survenu lors du like de ce post"] });
            return;
        }
        return res.json({ worked: true, errors: [] });
    } catch {
        return res.json({ worked: false, errors: [DEFAULT_ERROR_MSG] })
    }
});

app.post('/subscribe', async (req, res) => {
    try {
        let from_id = parseInt(req.body.from_id);
        let to_id = parseInt(req.body.to_id);
        let subbing = req.body.subbing;

        if (subbing) {
            await client.query("INSERT INTO subscriber(id_from, id_to) VALUES ($1, $2);", [from_id, to_id]);
        } else {
            await client.query("DELETE FROM subscriber WHERE id_from = $1 AND id_to = $2;", [from_id, to_id]);
        }
        return res.json({ worked: true, errors: [] });
    } catch {
        return res.json({ worked: false, errors: [DEFAULT_ERROR_MSG] })
    }
});

app.post('/login', async (req, res) => {
    try {
        let username = req.body.username;
        let password = req.body.password;

        if (username.trim() === "" || password.trim() === "") return res.json({ logged: false });
        let e = await (await client.query("SELECT * FROM client WHERE username = $1 and password = $2", [username, password]));
        if (e.rowCount <= 0) return res.json({ worked: false, errors: ["Aucun utilisateur ne correspond aux informations que vous nous avez fournis"] })

        let s = await (await client.query("SELECT id_to as id FROM subscriber WHERE id_from = $1;", [e.rows[0].id_client]));
        let i = await (await client.query("SELECT id_from as id FROM subscriber WHERE id_to = $1;", [e.rows[0].id_client]));
        return res.json({ worked: true, errors: [], result: { u_id: e.rows[0].id_client, username: e.rows[0].username, subscribed: s.rows.map((e) => e.id), followers_nbr: i.rowCount } });
    } catch {
        return res.json({ worked: false, errors: [DEFAULT_ERROR_MSG] })
    }
});

app.post('/register', async (req, res) => {
    try {
        let username = req.body.username;
        let password = req.body.password;
        if (username.trim() === "" || password.trim() === "") return res.json({ worked: false, errors: ["L'un des champs est vide."] });
        let exists = await (await client.query("SELECT * FROM client WHERE username = $1;", [username]))
        if (exists.rowCount > 0) return res.json({ worked: false, errors: ["Pseudo déjà utilisé"] })
        await (await client.query("INSERT INTO client(username, password) VALUES ($1, $2);", [username, password]))
        return res.json({ worked: true, errors: [] })
    } catch {
        return res.json({ worked: false, errors: [DEFAULT_ERROR_MSG] })
    }
})

app.post('/change_img', async (req, res) => {
    new formidable.IncomingForm().parse(req, (err, fields, files) => {
        if (err)
            return res.json({ worked: false, errors: [DEFAULT_ERROR_MSG] });
        let u_id = fields.u_id;
        let old_path = files.image.path;

        let new_path = img_upload_path + u_id + '.png';

        fs.rename(old_path, new_path, function (err) {
            if (err) return res.json({ worked: false, errors: ["Une erreur est survenue lors de la sauvegarde de votre image"] });
            return res.json({ worked: true, errors: [] })
        });
    })
})

app.post('/change_username', async (req, res) => {
    try {
        let username = req.body.username;
        let id = req.body.u_id;

        if (await (await client.query("SELECT * FROM client where username = $1", [username])).rowCount > 0)
            return res.json({ worked: false, errors: ["Pseudo déjà utilisé"] })

        await (await client.query("UPDATE client SET username = $1 WHERE id_client = $2", [username, id]))
        return res.json({ worked: true, errors: [] })
    } catch {
        return res.json({ worked: false, errors: [DEFAULT_ERROR_MSG] })
    }
})

app.listen(4000);