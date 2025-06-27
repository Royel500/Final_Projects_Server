const express = require('express');
const cors = require('cors');
const app =express();
const { ObjectId } = require('mongodb');
const port = process.env.PORT || 3000 ;
require('dotenv').config();
const { MongoClient, ServerApiVersion } = require('mongodb');



app.use(cors());
app.use(express.json());






const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.zw6xweg.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

// ---collection---

const percelCollection = client.db('Final_Projects').collection('percelCollection');


// -----post the percel on the database ----------

    app.post('/sendPercel', async (req, res) => {
      const newPercel = req.body;
      const result = await percelCollection.insertOne(newPercel);
      res.send(result);
    });

    // -----get data from database---------

    app.get('/sendPercel', async (req, res) => {
      const result = await percelCollection.find().toArray();
      res.send(result);
    });


    // -----get all parcels or filter by userEmail if provided-----
    app.get('/sendPercel', async (req, res) => {
      const email = req.query.email;
      let query = userEmail ? { createBy:userEmail}:{};
      if (email) {
        query.userEmail = email;
      }
      const result = await percelCollection.find(query).toArray();
      res.send(result);
    });


        // DELETE parcel by id
    app.delete('/sendPercel/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await percelCollection.deleteOne(query);
      res.send(result);
    });


    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);







app.get('/' ,(req,res)=>{
    res.send('Hi I am here from the Final Projects')
});

app.listen(port, () =>{
    console.log(`Cool Bro I am updating ${port}`)
})