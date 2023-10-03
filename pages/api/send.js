require("dotenv").config();
const sgMail = require("@sendgrid/mail");

const { SG_API_KEY, FROM_EMAIL, TO_EMAIL } = process.env;
sgMail.setApiKey(SG_API_KEY);

export default async function handler(req, res) {
  const { name, email, message, phone } = req.body;
  const msg = {
    to: TO_EMAIL, // Change to your recipient
    from: FROM_EMAIL, // Change to your verified sender
    subject: "Contact",
    html: `<p><strong>name: </strong>${name}</p>
    <p><strong>email: </strong>${email}</p> 
    <p><strong>phone: </strong>${phone}</p>   
    <p><strong>message: </strong>${message}</p>`,
  };

  try {
    await sgMail.send(msg)
    res.status(200).send('Message sent successfully.')
  } catch (error) {
    console.log('ERROR', error)
    res.status(400).send('Message not sent.')
  }
}