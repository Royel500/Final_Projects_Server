const express = require('express');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 3500 ;
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();
const stripe = require('stripe')(process.env.PAYMENT_GAITEWAY_KEY);
const admin = require("firebase-admin");



app.use(cors());
app.use(express.json());

const decodedKey =Buffer.from(process.env.ADMIN_KEY, 'base64').toString('utf8');
const serviceAccount =JSON.parse(decodedKey);

  admin.initializeApp({
  credential:admin.credential.cert(serviceAccount),
});



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

    
// ---collection---

  const percelCollection  = client.db('Final_Projects').collection('percelCollection');
  const paymentHistory    = client.db('Final_Projects').collection('payments');
  const userCollection    = client.db('Final_Projects').collection('users');
  const riderCollection   = client.db('Final_Projects').collection('riders');

// ---verify token------
const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).send({ message: 'Unauthorized  access' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decodedUser = await admin.auth().verifyIdToken(token);
    req.user = decodedUser; // contains uid, email, etc.
    next();
  } catch (error) {
    res.status(403).send({ message: 'Forbidden: Invalid token' });
  }
};


// Add this to your server routes
app.get('/riders/check', async (req, res) => {
  try {
    const email = req.query.email;
    const rider = await riderCollection.findOne({ email });
    res.json({ 
      exists: !!rider,
      status: rider?.status || ''
    });
  } catch (error) {
    res.status(500).json({ error: 'Error checking application' });
  }
});  

// Search parcels by contact number (sender or receiver)
app.get('/parcels/search', async (req, res) => {
    try {
        const contactNumber = req.query.contact;
        if (!contactNumber) {
            return res.status(400).json({ error: 'Contact number is required' });
        }

        const parcels = await percelCollection.find({
            $or: [
                { senderContact: contactNumber },
                { receiverContact: contactNumber }
            ]
        }).toArray();

        res.json(parcels);
    } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({ error: 'Failed to search parcels' });
    }
});
// ------admin page--Payment history-------
app.get('/adminPaymentList', async (req, res) => {

  try {
    const payments = await paymentHistory
      .find()               
      .sort({ date: -1 })   
      .toArray();

    res.status(200).json(payments);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch payment history' });
  }
});


// PATCH /users/:email - update user profile and return updated user
app.patch('/users/update/:email', async (req, res) => {
  const email = req.params.email?.toLowerCase();
  const { email: _, role: __, ...safeUpdates } = req.body;

  try {
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ success: false, message: 'Invalid email' });
    }

    const result = await userCollection.updateOne(
      { email: email },  // Match lowercased email consistently
      { $set: safeUpdates }
    );

    if (result.modifiedCount === 0) {
      return res.status(404).json({ success: false, message: 'User not found or no changes made' });
    }

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      modifiedCount: result.modifiedCount
    });
  } catch (err) {
    console.error('Error in PATCH /api/users/:email:', err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Example for MongoDB

app.get('/users/:email', async (req, res) => {
  try {
    const email = req.params.email.toLowerCase();
    const user = await userCollection.findOne({ email });
    user ? res.send(user) : res.status(404).send('User not found');
  } catch (error) {
    res.status(500).send('Server error');
  }
});

// -----------veryfy admin role----------

const isAdmin = async (req, res, next) => {
  const email = req.user?.email;
  if (!email) {
    return res.status(403).send({ message: 'Forbidden: No email found in token' });
  }

  const user = await userCollection.findOne({ email });
  if (user?.role !== 'admin') {
    return res.status(403).send({ message: 'Forbidden: Admins only' });
  }

  next();
};




app.post('/api/users', async (req, res) => {
  try {
    const { uid, name, email, photoURL, role } = req.body;

    if (!uid || !email) {
      return res.status(400).json({ message: 'UID and Email are required' });
    }

    const existingUser = await userCollection.findOne({ uid });

    if (existingUser) {
      return res.status(200).json({ message: 'User already exists', user: existingUser });
    }

    const newUser = {
      uid,
      name,
      email,
      photoURL,
      role: role || 'user',
      createdAt: new Date(),
    };

    const result = await userCollection.insertOne(newUser);
    res.status(201).json({ message: 'User created', user: result });
  } catch (err) {
    console.error(' Server Error:', err.message, err.stack);
    res.status(500).json({ message: 'Internal Server Error', error: err.message });
  }
});

// ---------admin overview ----------------------------------------------

// ----------admin-----------
app.get('/admin/dashboard/stats', async (req, res) => {
  try {
    const [
      riders,
      clients,
      totalUsers, // Added total users count
      parcels,
      payments
    ] = await Promise.all([
      riderCollection.estimatedDocumentCount(),
      userCollection.countDocuments({ role: "user" }),
      userCollection.estimatedDocumentCount(), // Total users count
      percelCollection.estimatedDocumentCount(),
      paymentHistory.aggregate([
        { $group: { _id: null, totalAmount: { $sum: "$amount" } } }
      ]).toArray()
    ]);

    res.json({
      success: true,
      stats: {
        riders,
        clients,
        totalUsers, // Include total users in response
        parcels,
        payments: payments[0]?.totalAmount || 0
      }
    });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to fetch dashboard statistics'
    });
  }
});
    // Additional optimized endpoints for the admin dashboard
// Recent activity endpoint
app.get('/admin/recent-activity', async (req, res) => {
  try {
    const [parcels, payments, riders] = await Promise.all([
      percelCollection.find()
        .sort({ _id: -1 })
        .limit(5)
        .toArray(),
      paymentHistory.find()
        .sort({ date: -1 })
        .limit(5)
        .toArray(),
      riderCollection.find()
        .sort({ _id: -1 })
        .limit(5)
        .toArray()
    ]);

    const activities = [
      ...parcels.map(p => ({
        type: 'delivery',
        description: `New parcel from ${p.senderName}`,
        timestamp: p.createdAt,
        user: p.CreateBy
      })),
      ...payments.map(p => ({
        type: 'payment',
        description: `Payment of $${p.amount} received`,
        timestamp: p.date,
        user: p.userEmail
      })),
      ...riders.map(r => ({
        type: 'user',
        description: `New rider ${r.name} registered`,
        timestamp: r.createdAt,
        user: r.email
      }))
    ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
     .slice(0, 5);

    res.json(activities);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch recent activity' });
  }
});




  // -----post the percel on the database ----------

    app.post('/sendPercel', async (req, res) => {
      const newPercel = req.body;
      const result = await percelCollection.insertOne(newPercel);
      res.send(result);
    });


    // --------post rider collection-------
    app.post('/riders' , async(req,res) =>{
      const newRider = req.body;
      const result = await riderCollection.insertOne(newRider);
      res.send(result);
    });

    
    // ✅ GET /pending-riders
    app.get('/pending', async (req, res) => {
      const pending = await riderCollection.find({ status: 'pending' }).toArray();
      res.send(pending);
    });
    // ✅ GET /Active-riders
    app.get('/active', async (req, res) => {
      const pending = await riderCollection.find({ status: 'active' }).toArray();
      res.send(pending);
    });


// ----get data which is paid -------------
    app.get('/parcels/paid', async (req, res) => {
  try {
    const paidParcels = await percelCollection.find({ payment_status: 'paid' }).toArray();
    res.send(paidParcels);
  } catch (error) {
    res.status(500).send({ message: 'Server error fetching paid parcels' });
  }
});


// ----------assign rider for thr parcels------
// GET /riders?district=Dhaka


// GET: Filter riders whose district === parcel.senderRegion
app.get('/riders/by-region', async (req, res) => {
  const { region } = req.query;

  if (!region) {
    return res.status(400).json({ success: false, message: 'Region is required' });
  }

  try {
    const matchedRiders = await riderCollection
      .find({ district: { $regex: new RegExp(`^${region}$`, 'i') } })
      .toArray();

    res.send(matchedRiders); // return just the array
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
});

// -------assignRider-------------
app.patch('/assignRider', async (req, res) => {
  const { parcelId, riderId,riderName,riderEmail } = req.body;

  if (!parcelId || !riderId) {
    return res.status(400).send({ success: false, message: 'parcelId and riderId are required' });
  }

  try {
    // 1. Update parcel: assign rider + set delivery_status
    const parcelUpdate = await percelCollection.updateOne(
      { _id: new ObjectId(parcelId) },
      {
        $set: {
          delivery_status: 'rider_assign',
          delivery_Boy:riderName,
          delivery_boy_email:riderEmail,
          assignedRider: new ObjectId(riderId),
        },
      }
    );

    // 2. Update rider status to busy
    const riderUpdate = await riderCollection.updateOne(
      { _id: new ObjectId(riderId) },
      { $set: { delivery_status: 'busy'} }
    );

    res.send({
      success: true,
      parcelModified: parcelUpdate.modifiedCount,
      riderModified: riderUpdate.modifiedCount,
    });
  } catch (error) {
    console.error('Error assigning rider:', error);
    res.status(500).send({ success: false, message: 'Server error' });
  }
});


// GET: Rider's pending delivery tasks
// ✅ GET: Rider's pending delivery tasks
app.get('/parcels/rider/pending', async (req, res) => {
  const { email } = req.query;

  if (!email) {
    return res.status(400).json({ success: false, message: 'Rider email is required' });
  }

  try {
    const pendingParcels = await percelCollection.find({
      delivery_boy_email: email,
      delivery_status: { $in: ['rider_assign', 'in_transit'] }
    }).sort({ creation_date: -1 }).toArray();

    res.send({ success: true, data: pendingParcels });
  } catch (error) {
    console.error('Error fetching pending deliveries:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});


// ----successfully delivered-----
app.patch('/parcels/mark-delivered/:id', async (req, res) => {
  const id = req.params.id;

  try {
    const result = await percelCollection.updateOne(
      { _id: new ObjectId(id), delivery_status: { $in: ['rider_assign', 'in_transit'] } },
      { $set: { delivery_status: 'delivered' } }
    );

    if (result.modifiedCount === 1) {
      res.send({ success: true });
    } else {
      res.status(400).send({ success: false, message: 'Parcel not found or already delivered.' });
    }
  } catch (err) {
    console.error('Error updating delivery status:', err);
    res.status(500).send({ success: false, message: 'Server error' });
  }
});


    // ----update the status--------
// ---- Approve rider and update user role ----
app.patch('/riders/approve/:id', async (req, res) => {
  const id = req.params.id;
  const { status } = req.body; // expecting { status: 'active' }

  try {
    // 1. Find the rider by ID
    const rider = await riderCollection.findOne({ _id: new ObjectId(id) });

    if (!rider) {
      return res.status(404).send({ success: false, message: 'Rider not found.' });
    }

    // 2. Update rider's status to 'active'
    const updateRider = await riderCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status } }
    );

    // 3. Update user's role to 'rider' in users collection
    const updateUser = await userCollection.updateOne(
      { email: rider.email },
      { $set: { role: 'rider' } }
    );

    res.send({
      success: true,
      message: 'Rider approved and user role updated.',
      updateRider,
      updateUser,
    });
  } catch (error) {
    console.error('Approval error:', error);
    res.status(500).send({ success: false, message: 'Server error during approval.' });
  }
});


// -------admin  role---------------

// ✅ Add route to update user role to 'admin' or remove 'admin'
app.patch('/users/role', async (req, res) => {
  const { email, role } = req.body; // role can be 'admin' or 'user'

  if (!email || !role) {
    return res.status(400).send({ success: false, message: 'Email and role are required.' });
  }

  try {
    const result = await userCollection.updateOne(
      { email },
      { $set: { role } }
    );

    if (result.modifiedCount === 1) {
      res.send({ success: true, message: `User role updated to ${role}.` });
    } else {
      res.status(404).send({ success: false, message: 'User not found or role unchanged.' });
    }
  } catch (error) {
    console.error('Role update error:', error);
    res.status(500).send({ success: false, message: 'Server error.' });
  }
});

// ✅ Add route to search for a user by email
app.get('/users/search', async (req, res) => {
  const email = req.query.email;

  if (!email) {
    return res.status(400).send({ success: false, message: 'Email query is required.' });
  }

  try {
    const user = await userCollection.findOne(
      { email },
      { projection: { name: 1, email: 1, role: 1, createdAt: 1 } }
    );

    if (user) {
      res.send({ success: true, user });
    } else {
      res.status(404).send({ success: false, message: 'User not found.' });
    }
  } catch (error) {
    console.error('User search error:', error);
    res.status(500).send({ success: false, message: 'Server error.' });
  }
});

// -----------role check admin or not -----------

// GET: get role by email
app.get('/users/role/:email', async (req, res) => {
  const email = req.params.email;

  try {
    const user = await userCollection.findOne({ email }, { projection: { role: 1 } });
    if (user?.role) {
      res.send({ success: true, role: user.role });
    } else {
      res.status(404).send({ success: false, message: 'Role not found' });
    }
  } catch (error) {
    res.status(500).send({ success: false, message: 'Server error' });
  }
});


// -----------riders details-------------------
app.get('/riders/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const rider = await riderCollection.findOne({ _id: new ObjectId(id) });

    if (rider) {
      res.send(rider);
    } else {
      res.status(404).send({ message: 'Rider not found' });
    }
  } catch (error) {
    res.status(500).send({ message: 'Server error' });
  }
});

    // -----get all parcels or filter by userEmail if provided-----
app.get('/sendPercel', async (req, res) => {
  const email = req.query.email;

  let query = {};
  if (email) {
    query.CreateBy = email; // Use the correct field name
  }
  const result = await percelCollection.find(query).sort({ date: -1 }).toArray();
  res.send(result);
});





// Get a single parcel by ID
app.get('/sendPercel/:id', async (req, res) => {
  const id = req.params.id;

  try {
    const query = { _id: new ObjectId(id) };
    const result = await percelCollection.findOne(query);
    if (result) {
      res.send(result);
    } else {
      res.status(404).send({ message: 'Parcel not found' });
    }
  } catch (error) {
    res.status(500).send({ message: 'Invalid ID or Server Error' });
  }
});

// -----------payment-----------
app.post('/create-payment-intent', async (req, res) => {
  const amountInCents = req.body.amountInCents;

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: 'usd',
      payment_method_types: ['card'], 
    });

    res.json({ clientSecret: paymentIntent.client_secret });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});



// ----post the payment history------3333333
   // POST: Create PaymentIntent
    app.post('/create-payment-intent', async (req, res) => {
      const amountInCents = req.body.amountInCents;

      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amountInCents,
          currency: 'usd',
          payment_method_types: ['card'],
        });

        res.json({ clientSecret: paymentIntent.client_secret });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });



    // POST: Save Payment + Mark Parcel as Paid
app.post('/payments', async (req, res) => {
  const paymentInfo = req.body;

  try {
    // 1. Save payment record
    const result = await paymentHistory.insertOne(paymentInfo);

    // 2. Update parcel's payment status
    if (paymentInfo.parcelId) {
      const updateResult = await percelCollection.updateOne(
        { _id: new ObjectId(paymentInfo.parcelId) },
        { $set: { payment_status: 'paid' } }
      );
    } else {
    }

    res.send({ success: true, result });
  } catch (err) {
    res.status(500).send({ success: false, error: err.message });
  }
});
    // GET: Payment history by user
   app.get('/payments', async (req, res) => {
  const email = req.query.email;
  try {
    const result = await paymentHistory.find({ userEmail: email }).sort({ date: -1 }).toArray();
    res.send(result);
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});
   


// ----------delete---------
   app.delete('/riders/delete/:id', async (req, res) => {
  const id = req.params.id;
  try {
    const result = await riderCollection.deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount === 1) {
      res.send({ success: true, message: 'Rider deleted successfully' });
    } else {
      res.status(404).send({ success: false, message: 'Rider not found' });
    }
  } catch (error) {
    console.error('Delete rider error:', error);
    res.status(500).send({ success: false, message: 'Server error' });
  }
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
  }
}
run().catch(console.dir);





app.get('/' ,(req,res)=>{
    res.send('Hi I am here from the Assignment_12 Last Projects')
});

app.listen(port, () =>{
    console.log(`Cool Bro I am updating ${port}`)
})