<?php
if(isset($_POST['submit'])) {
$to = "m.polkiewicz@gmail.com";
$subject = "Polkiewicz.com Contact";
 
// data the visitor provided
$name_field = filter_var($_POST['Name'], FILTER_SANITIZE_STRING);
$email_field = filter_var($_POST['Email'], FILTER_VALIDATE_EMAIL);
$comment = filter_var($_POST['Message'], FILTER_SANITIZE_STRING);
 
//constructing the message
$body = " From: $name_field\n\n E-Mail: $email_field\n\n Message:\n\n $comment";
 
// ...and away we go!
mail($to, $subject, $body);
 
// redirect to confirmation
header('Location: confirmation.htm');
} else {
// handle the error somehow
}
?>
